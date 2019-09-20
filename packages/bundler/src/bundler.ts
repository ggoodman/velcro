import remapping from '@ampproject/remapping';
import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { Resolver } from '@velcro/resolver';
import { Base64 } from 'js-base64';
import MagicString, { Bundle } from 'magic-string';

import { isBareModuleSpecifier, getSourceMappingUrl } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { parseFile } from './parser';
import { Asset } from './asset';
import { createRuntime } from './runtime';
import { Queue } from './queue';

const EMPTY_MODULE_HREF = new URL('velcro://@empty');
const EMPTY_MODULE_CODE = 'module.exports = function(){};';

const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
  Buffer: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/buffer.js`,
    export: 'Buffer',
  },
  global: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/global.js`,
  },
  process: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/process.js`,
  },
};

export class Bundler {
  private readonly aliases = new Map<string, string>();
  private readonly assetsByHref = new Map<string, Asset>();
  private readonly aliasDependencies = new Map<string, Set<Asset>>();
  private readonly pendingAdds = new Map<string, Promise<Asset>>();
  private readonly pendingResolves = new Map<string, Promise<Asset>>();
  private readonly resolver: Resolver;

  constructor(options: Bundler.Options) {
    this.resolver = options.resolver;
  }

  private async addUnresolved(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveKey = `${href}\0${fromHref}`;

    let pendingResolve = this.pendingResolves.get(resolveKey);

    if (!pendingResolve) {
      pendingResolve = this.addResolving(queue, href, fromHref);
      this.pendingResolves.set(resolveKey, pendingResolve);
    }

    try {
      return await pendingResolve;
    } finally {
      this.pendingResolves.delete(resolveKey);
    }
  }

  private async addResolving(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveResult = await this.resolveWithDetails(href, fromHref);

    let asset = this.assetsByHref.get(resolveResult.resolvedHref);

    if (!asset) {
      asset = new Asset(resolveResult.resolvedHref, resolveResult.rootHref);
      this.assetsByHref.set(resolveResult.resolvedHref, asset);

      const code = await this.readCode(resolveResult.resolvedHref);

      asset.magicString = new MagicString(code, {
        filename: resolveResult.resolvedHref,
        indentExclusionRanges: [],
      });
      asset.sourceMappingUrl = getSourceMappingUrl(code);

      const parser = getParserForFile(resolveResult.resolvedHref);

      const parsedFile = parser.parse(resolveResult.resolvedHref, asset.magicString);

      for (const dependency of parsedFile.requireDependencies) {
        queue.add(async () => {
          const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, resolveResult.resolvedHref);

          asset!.dependencies.push({
            type: Asset.DependencyKind.Require,
            asset: dependencyAsset,
            callee: dependency.callee,
            spec: dependency.spec,
          });

          return dependencyAsset;
        });
      }

      for (const dependency of parsedFile.requireResolveDependencies) {
        queue.add(async () => {
          const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, resolveResult.resolvedHref);

          asset!.dependencies.push({
            type: Asset.DependencyKind.RequireResolve,
            asset: dependencyAsset,
            callee: dependency.callee,
            spec: dependency.spec,
          });

          return dependencyAsset;
        });
      }

      for (const [symbolName, references] of parsedFile.unboundSymbols) {
        const shim = DEFAULT_SHIM_GLOBALS[symbolName];

        if (shim) {
          queue.add(async () => {
            const dependencyAsset = await this.addUnresolved(queue, shim.spec, resolveResult.resolvedHref);

            asset!.dependencies.push({
              type: Asset.DependencyKind.InjectedGlobal,
              asset: dependencyAsset,
              references,
              exportName: shim.export,
              symbolName,
            });

            return dependencyAsset;
          });
        }
      }
    }

    return asset;
  }

  /**
   * Add an asset and its dependency tree to the bundle
   *
   * @param spec A resolvable asset that should be added
   */
  async add(spec: string, options: Bundler.AddOptions = {}): Promise<Asset | undefined> {
    const queue = new Queue(options.onEnqueueAsset, options.onCompleteAsset);
    const asset = await this.addUnresolved(queue, spec);

    this.aliases.set(spec, asset.href);

    const assets = await queue.wait();

    assets.add(asset);

    this.aliasDependencies.set(spec, assets);

    return asset;
  }

  generateBundleCode(options: { entrypoint?: string; sourceMap?: boolean } = {}): string {
    if (this.pendingAdds.size || this.pendingResolves.size) {
      throw new Error(`Unable to generate bundle code while assets are being loaded`);
    }

    if (options.entrypoint && !this.aliases.has(options.entrypoint)) {
      throw new Error(`Unable to generate bundle with an unknown entrypoint ${options.entrypoint}`);
    }

    const bundle = new Bundle({ separator: '\n' });

    for (const [aliasFrom, aliasTo] of this.aliases) {
      bundle.append(`Velcro.runtime.alias(${JSON.stringify(aliasFrom)}, ${JSON.stringify(aliasTo)});\n`);
    }

    for (const [, asset] of this.assetsByHref) {
      if (!asset.magicString) {
        throw new Error(`Invariant violation: asset is not loaded ${asset.href}`);
      }

      const magicString = asset.magicString;

      magicString.trim();

      // We'll replace each dependency string with the resolved stable href. The stable href doesn't require any
      // information about where it is being resolved from, so it is useful as a long-term pointer whose target
      // can change over time
      for (const dependency of asset.dependencies) {
        switch (dependency.type) {
          case Asset.DependencyKind.Require:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.asset.href));
            magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
            break;
          case Asset.DependencyKind.RequireResolve:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.asset.href));
            // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
            break;
          case Asset.DependencyKind.InjectedGlobal:
            magicString.prepend(
              `const ${dependency.symbolName} = __velcro_require(${JSON.stringify(dependency.asset.href)})${
                dependency.exportName ? `.${dependency.exportName}` : ''
              };\n`
            );
            break;
          default:
            throw new Error(`Invariant violation: Encountered unexpected dependency kind ${(dependency as any).type}`);
        }
      }

      magicString.trim();
      magicString.prepend(
        `Velcro.runtime.register(${JSON.stringify(
          asset.href
        )}, function(module, exports, __velcro_require, __dirname, __filename){\n`
      );

      magicString.append('\n});');

      bundle.addSource(magicString);
    }

    bundle.prepend(
      `(${createRuntime.toString()})(typeof globalThis === 'object' ? (globalThis.Velcro || (globalThis.Velcro = {})) : (this.Velcro || (this.Velcro = {})));\n`
    );

    if (options.entrypoint) {
      bundle.append(`Velcro.runtime.require(${JSON.stringify(options.entrypoint)});\n`);
    }

    const bundleCode = bundle.toString();

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMap = bundle.generateMap({
        includeContent: false,
        hires: false,
      });

      sourceMap.file = `velcro://${options.entrypoint || 'root'}`;

      // In case a source map seems to be self-referential, avoid crashing
      const seen = new Set<Asset>();
      const combinedMap = remapping(
        sourceMap.toString(),
        (uri: string) => {
          const asset = this.assetsByHref.get(uri);

          if (asset && asset.sourceMappingUrl) {
            if (seen.has(asset)) {
              return null;
            }

            seen.add(asset);

            const match = asset.sourceMappingUrl.match(/^data:application\/json;(?:charset=([^;]+);)?base64,(.*)$/);

            if (match) {
              if (match[1] && match[1] !== 'utf-8') {
                return null;
              }

              try {
                const decoded = JSON.parse(Base64.decode(match[2]));

                return decoded;
              } catch (err) {
                return null;
              }
            }
          }

          return null;
        },
        false
      );

      sourceMapSuffix = `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa(
        JSON.stringify(combinedMap)
      )}`;
    }

    return `${bundleCode}${sourceMapSuffix}`;
  }

  async remove(href: string): Promise<boolean> {
    const aliasDependencies = this.aliasDependencies.get(href);

    if (!aliasDependencies) {
      return false;
    }

    this.aliasDependencies.delete(href);
    this.aliases.delete(href);

    dependency: for (const dependency of aliasDependencies) {
      for (const otherDependencies of this.aliasDependencies.values()) {
        if (otherDependencies.has(dependency)) {
          continue dependency;
        }
      }

      this.assetsByHref.delete(dependency.href);
    }

    return true;
  }

  private async readCode(uri: string): Promise<string> {
    if (uri === EMPTY_MODULE_HREF.href) {
      return EMPTY_MODULE_CODE;
    }

    const buf = await this.resolver.host.readFileContent(this.resolver, new URL(uri));
    const code = this.resolver.decoder.decode(buf);

    return code;
  }

  private async resolveWithDetails(uri: string, fromUri?: string): Promise<Bundler.ResolveDetails> {
    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri);

      if (!bareModuleResolveResult.stableUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable url`);
      }

      if (!bareModuleResolveResult.stableRootUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable root url`);
      }

      const resolvedHref = bareModuleResolveResult.resolvedUrl
        ? bareModuleResolveResult.resolvedUrl.href
        : EMPTY_MODULE_HREF.href;

      return {
        type: Bundler.ResolveDetailsKind.BareModule,
        bareModule: {
          isBuiltIn: bareModuleResolveResult.bareModule.isBuiltIn,
          version: bareModuleResolveResult.bareModule.version,
          versionSpec: bareModuleResolveResult.bareModule.versionSpec,
        },
        ignored: bareModuleResolveResult.ignored,
        resolvedHref,
        rootHref: bareModuleResolveResult.rootUrl.href,
        stableHref: bareModuleResolveResult.stableUrl.href,
        stableRootHref: bareModuleResolveResult.stableRootUrl.href,
      };
    }

    const combinedUri = new URL(uri, fromUri);
    const resolveResult = await this.resolver.resolveWithDetails(combinedUri);

    let resolvedUri: URL;

    if (!resolveResult.resolvedUrl) {
      resolvedUri = EMPTY_MODULE_HREF;
    } else {
      resolvedUri = resolveResult.resolvedUrl;
    }

    const resolvedHref = resolvedUri.href;
    const rootHref = resolveResult.rootUrl.href;

    return {
      type: Bundler.ResolveDetailsKind.Relative,
      ignored: resolveResult.ignored,
      resolvedHref,
      rootHref,
      stableHref: resolvedHref,
      stableRootHref: rootHref,
    };
  }
}

export namespace Bundler {
  export interface AddOptions {
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
  }

  export interface Options {
    resolver: Resolver;
  }

  export enum ResolveDetailsKind {
    BareModule = 'bare_module',
    Relative = 'relative',
  }

  interface BareModuleResolveDetails {
    type: ResolveDetailsKind.BareModule;
    bareModule: {
      isBuiltIn: boolean;
      versionSpec?: string;
      version?: string;
    };
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  interface RelativeResolveDetails {
    type: ResolveDetailsKind.Relative;
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  export type ResolveDetails = BareModuleResolveDetails | RelativeResolveDetails;
}

function getParserForFile(uri: string): { parse: typeof parseFile } {
  if (uri.endsWith('.json')) {
    return {
      parse: (_uri, magicString): ReturnType<typeof parseFile> => {
        magicString.prepend('module.exports = ');

        return {
          requireDependencies: [],
          requireResolveDependencies: [],
          unboundSymbols: new Map(),
        };
      },
    };
  }

  return {
    parse: parseFile,
  };
}
