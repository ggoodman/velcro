import {
  checkCancellation,
  DependencyNotFoundError,
  EntryExcludedError,
  EntryNotFoundError,
  isThenable,
  Uri,
} from '@velcro/common';
import { ResolverContext } from '@velcro/resolver';
import MagicString, { DecodedSourceMap, SourceMap } from 'magic-string';
import { decodeDataUriAsSourceMap, getSourceMappingUrl } from '../build/sourceMap';
import { Link, Source } from '../build/sourceMapTree';
import { SourceModule, SourceModuleDependency } from '../graph';
import {
  Plugin,
  PluginLoadContext,
  PluginResolveDependencyContext,
  PluginResolveEntrypointContext,
  PluginTransformContext,
} from './plugin';

export class PluginManager {
  constructor(private readonly plugins: Plugin[]) {
    this.plugins.push({
      name: 'builtIn',
      load: async (ctx, id) => {
        const uri = Uri.parse(id);
        const readReturn = ctx.readFileContent(uri);
        const readResult = isThenable(readReturn)
          ? await checkCancellation(readReturn, ctx.token)
          : readReturn;

        return {
          code: ctx.decoder.decode(readResult.content),
          visited: readResult.visited,
        };
      },
      resolveDependency: async (ctx, dependency, fromSourceModule) => {
        const resolveReturn = ctx.resolve(dependency.spec, fromSourceModule.uri);
        const resolveResult = isThenable(resolveReturn)
          ? await checkCancellation(resolveReturn, ctx.token)
          : resolveReturn;

        if (!resolveResult.found) {
          throw new DependencyNotFoundError(dependency.spec, fromSourceModule);
        }

        if (!resolveResult.uri) {
          // TODO: Inject empty module
          throw new EntryExcludedError(dependency.spec);
        }

        return {
          uri: resolveResult.uri,
          rootUri: resolveResult.rootUri,
          visited: resolveResult.visited,
        };
      },
      resolveEntrypoint: async (ctx, uri) => {
        const resolveResult = await ctx.resolveUri(uri);

        if (!resolveResult.found) {
          throw new EntryNotFoundError(`Entry point not found: ${uri}`);
        }

        if (!resolveResult.uri) {
          throw new EntryExcludedError(uri);
        }

        return resolveResult;
      },
      transform: async ({}, id, code) => {
        if (id.path.endsWith('.json')) {
          const magicString = new MagicString(code);
          magicString.prepend('module.exports = ');

          return {
            code,
            sourceMap: magicString.generateDecodedMap(),
          };
        }
      },
    });
  }

  async executeLoad(ctx: ResolverContext, uri: Uri) {
    const pluginCtx: PluginLoadContext = Object.assign(ctx, {});
    for (const plugin of this.plugins) {
      if (typeof plugin.load === 'function') {
        const loadReturn = plugin.load(pluginCtx, uri.toString());
        const loadResult = isThenable(loadReturn)
          ? await checkCancellation(loadReturn, ctx.token)
          : loadReturn;

        if (!loadResult) {
          continue;
        }

        return {
          code: loadResult.code,
          visited: loadResult.visited || [],
        };
      }
    }

    throw new Error(`No plugin was found that was able to load the uri ${uri.toString()}`);
  }

  async executeResolveDependency(
    ctx: ResolverContext,
    dependency: SourceModuleDependency,
    fromModule: SourceModule
  ) {
    const pluginCtx: PluginResolveDependencyContext = Object.assign(ctx, {});
    for (const plugin of this.plugins) {
      if (typeof plugin.resolveDependency === 'function') {
        const loadReturn = plugin.resolveDependency(pluginCtx, dependency, fromModule);
        const loadResult = isThenable(loadReturn)
          ? await checkCancellation(loadReturn, ctx.token)
          : loadReturn;

        if (!loadResult) {
          continue;
        }

        return {
          uri: loadResult.uri,
          rootUri: loadResult.rootUri,
          visited: loadResult.visited || [],
        };
      }
    }

    throw new Error(
      `No plugin was able to resolve the '${dependency.kind}' dependency, '${dependency.spec}' from '${fromModule.href}'`
    );
  }

  async executeResolveEntrypoint(ctx: ResolverContext, uri: Uri) {
    const pluginCtx: PluginResolveEntrypointContext = Object.assign(ctx, {});
    for (const plugin of this.plugins) {
      if (typeof plugin.resolveEntrypoint === 'function') {
        const loadReturn = plugin.resolveEntrypoint(pluginCtx, uri);
        const loadResult = isThenable(loadReturn)
          ? await checkCancellation(loadReturn, ctx.token)
          : loadReturn;

        if (!loadResult) {
          continue;
        }

        return {
          uri: loadResult.uri,
          rootUri: loadResult.rootUri,
          visited: loadResult.visited || [],
        };
      }
    }

    throw new Error(`No plugin was able to resolve the entrypoint '${uri.toString()}'`);
  }

  async executeTransform(ctx: ResolverContext, uri: Uri, code: string | ArrayBuffer) {
    if (typeof code !== 'string') {
      code = ctx.decoder.decode(code);
    }

    const pluginCtx: PluginTransformContext = Object.assign(ctx, {
      createMagicString() {
        return new MagicString(code as string);
      },
    });

    let sourceMapTree: Source | Link = new Source(uri.toString(), code);

    // Figure out if our original code, itself has a sourcemap.
    // For now, we will not recurse beyond that depth.
    const sourceMapRef = getSourceMappingUrl(code);
    if (sourceMapRef) {
      let sourceMap: DecodedSourceMap | SourceMap | null = decodeDataUriAsSourceMap(sourceMapRef);

      if (!sourceMap) {
        try {
          const sourceMapUri = Uri.joinPath(uri, `../${sourceMapRef}`);
          const result = await ctx.readFileContent(sourceMapUri);
          sourceMap = JSON.parse(ctx.decoder.decode(result.content)) as
            | DecodedSourceMap
            | SourceMap;
        } catch {
          // Do nothing
        }
      }

      if (sourceMap) {
        const sources = sourceMap.sources;
        const sourcesContent = sourceMap.sourcesContent || [];
        const baseSources = [] as Source[];

        for (const idx in sources) {
          if (sources[idx] && sourcesContent[idx]) {
            baseSources.push(new Source(sources[idx]!, sourcesContent[idx]!));
          }
        }

        sourceMapTree = new Link(sourceMap, baseSources);
      }
    }

    const visited = [] as ResolverContext.Visit[];

    for (const plugin of this.plugins) {
      if (typeof plugin.transform === 'function') {
        const transformReturn = plugin.transform(pluginCtx, uri, code);
        const transformResult = isThenable(transformReturn)
          ? await checkCancellation(transformReturn, ctx.token)
          : transformReturn;

        if (transformResult === null || transformResult === undefined) {
          continue;
        }

        if (transformResult.sourceMap) {
          sourceMapTree = new Link(transformResult.sourceMap, [sourceMapTree]);
        }

        code = transformResult.code;

        if (transformResult.visited) {
          visited.push(...transformResult.visited);
        }
      }
    }

    return {
      code,
      sourceMapTree,
      visited,
    };
  }
}
