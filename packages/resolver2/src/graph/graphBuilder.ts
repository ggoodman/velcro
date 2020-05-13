import MagicString from 'magic-string';
import { dirname, DisposableStore, Emitter } from 'ts-primitives';
import { checkCancellation, isThenable } from '../async';
import { ResolverContext, Visit } from '../context';
import {
  DependencyNotFoundError,
  EntryExcludedError,
  EntryNotFoundError,
  isCanceledError,
  ParseError,
} from '../error';
import { MapSet } from '../mapSet';
import { Resolver } from '../resolver';
import { Uri } from '../uri';
import { BareModuleSpec, parseBareModuleSpec } from './bareModules';
import { DependencyEdge } from './dependencyEdge';
import { GraphBuildError } from './errors';
import { Graph } from './graph';
import { ParentPackageJson } from './parentPackageJson';
import { parseJavaScript, parseJson } from './parser';
import { ParserFunction } from './parsing';
import { DEFAULT_SHIM_GLOBALS, NODE_CORE_SHIMS } from './shims';
import { SourceModule } from './sourceModule';
import { SourceModuleDependency } from './sourceModuleDependency';

type ExternalTestFunction = (
  dependency: SourceModuleDependency,
  fromSourceModule: SourceModule
) => boolean;

export interface BuildGraphOptions {
  entrypoints: Uri[];
  /**
   * Function used to signal whether a given dependency should be treated as external or not.
   *
   * An external dependency means that the graph traversal will not continue through that
   * dependency. The dependency must be injected at runtime.
   *
   * Example for building:
   *
   * ```ts
   * const graph = await buildGraph({
   *   resolver,
   *   external: (dep) =>
   *     dep.kind === SourceModuleDependencyKing.Require &&
   *     dep.spec === 'external'
   * });
   * ```
   *
   * Example at runtime:
   *
   * ```ts
   * velcro.inject('external', externalModule);
   * ```
   */
  external?: ExternalTestFunction;
  nodeEnv?: string;
  resolver: Resolver;
}

export function buildGraph(options: BuildGraphOptions) {
  const graphBuilder = new GraphBuilder({
    external: options.external,
    nodeEnv: options.nodeEnv || 'development',
    resolver: options.resolver,
  });

  return graphBuilder.buildGraph(options.entrypoints);
}

namespace GraphBuilder {
  export interface Options {
    external?: ExternalTestFunction;
    nodeEnv?: string;
    resolver: Resolver;
  }
}

class GraphBuilder {
  private readonly disposer = new DisposableStore();
  private readonly edges = new Set<DependencyEdge>();
  private readonly errors = [] as { ctx: ResolverContext; err: Error }[];
  private readonly external?: ExternalTestFunction;
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly rootCtx: ResolverContext;
  private readonly rootUri = Uri.parse('velcro:///root');
  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly sourceModules = new Map<string, SourceModule>();

  private readonly onErrorEmitter = new Emitter<{ ctx: ResolverContext; err: Error }>();

  constructor(options: GraphBuilder.Options) {
    this.resolver = options.resolver;
    this.rootCtx = this.resolver.createResolverContext();
    this.external = options.external;
    this.nodeEnv = options.nodeEnv || 'development';

    this.disposer.add(this.rootCtx);
    this.disposer.add(
      this.onError((event) => {
        this.errors.push(event);
      })
    );
  }

  get onError() {
    return this.onErrorEmitter.event;
  }

  dispose() {
    this.disposer.dispose();
  }

  async buildGraph(entrypoints: Uri[]) {
    const entrypointHrefs = entrypoints.map((entrypoint) => entrypoint.toString());
    const ctx = this.rootCtx.forOperation('GraphBuilder.buildGraph', entrypointHrefs.join(','), {
      resetPath: true,
      resetVisits: true,
    });

    this.onError(() => ctx.dispose());

    for (const uri of entrypoints) {
      ctx.runInChildContext('GraphBuilder.doAddUnresolvedUri', uri, (ctx) =>
        this.doAddUnresolvedUri(ctx, uri, SourceModuleDependency.fromEntrypoint(uri))
      );
    }

    try {
      // Flush the queue
      while (this.pendingModuleOperations.size) {
        await Promise.all(this.pendingModuleOperations.values());
      }
    } catch (err) {
      throw new GraphBuildError(this.errors);
    }

    return new Graph({
      edges: this.edges,
      rootUri: this.rootUri,
      sourceModules: this.sourceModules.values(),
    });
  }

  private addEdge(fromUri: Uri, toUri: Uri, visited: Visit[], dependency: SourceModuleDependency) {
    this.edges.add({ dependency, fromUri, toUri, visited });
  }

  private doAddModuleDependency(
    ctx: ResolverContext,
    sourceModule: SourceModule,
    dependency: SourceModuleDependency
  ) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = sourceModule.href;
    const operation = ctx.runInChildContext(
      'resolveDependency',
      `${href}|${dependency.spec}`,
      (ctx) => resolveDependency(ctx, sourceModule, dependency)
    );

    operation.then(
      (resolveResult) => {
        this.pendingModuleOperations.delete(href, operation);

        const dependencyHref = resolveResult.uri.toString();

        this.addEdge(sourceModule.uri, resolveResult.uri, resolveResult.visited, dependency);

        // To avoid circularity
        if (this.sourceModules.has(dependencyHref)) {
          return;
        }

        // If we already have pending operations for the same Uri, we can
        // assume that the module either already exists or soon will and
        // should not be re-read.
        if (this.pendingModuleOperations.has(dependencyHref)) {
          return;
        }

        ctx.runInChildContext('GraphBuilder.doAddResolvedUri', resolveResult.uri, (ctx) =>
          this.doAddResolvedUri(
            ctx,
            resolveResult.uri,
            resolveResult.rootUri,
            resolveResult.parentPackageJson
          )
        );
      },
      (err) => {
        this.pendingModuleOperations.delete(href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(href, operation);
  }

  private doAddResolvedUri(
    ctx: ResolverContext,
    uri: Uri,
    rootUri: Uri,
    parentPackageJson?: ParentPackageJson
  ) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext('readFileContent', uri, (ctx) =>
      readFileContent(ctx, uri)
    );

    operation.then(
      (contentResult) => {
        this.pendingModuleOperations.delete(href, operation);

        const parser = this.getParserForUri(uri);
        // console.time(`parseFile(${href})`);
        const code = ctx.decoder.decode(contentResult.content);

        const { dependencies, changes, syntax } = ctx.runInChildContext(
          `parse[${parser.name}]`,
          uri,
          () =>
            parser(uri, code, {
              environmentModules: NODE_CORE_SHIMS,
              globalModules: DEFAULT_SHIM_GLOBALS,
              nodeEnv: this.nodeEnv,
            })
        );
        // console.timeEnd(`parseFile(${href})`);

        const magicString = new MagicString(code, { filename: href, indentExclusionRanges: [] });

        changes.sort((a, b) => a.start - b.start);

        let lastPos = 0;

        for (const change of changes) {
          if (change.start < lastPos) {
            continue;
          }
          switch (change.type) {
            case 'appendRight':
              magicString.appendRight(change.start, change.value);
              lastPos = change.start;
              break;
            case 'remove':
              if (change.start < change.end) {
                magicString.remove(change.start, change.end);
                lastPos = change.end;
              }
              break;
            case 'overwrite':
              if (change.start < change.end) {
                magicString.overwrite(change.start, change.end, change.value, {
                  contentOnly: true,
                  storeName: true,
                });
                lastPos = change.end;
              }
              break;
          }
        }

        const sourceModule = new SourceModule(
          uri,
          rootUri,
          parentPackageJson,
          magicString,
          syntax,
          new Set(dependencies)
        );
        this.sourceModules.set(sourceModule.href, sourceModule);

        for (const dependency of sourceModule.dependencies) {
          if (!this.external || !this.external(dependency, sourceModule)) {
            ctx.runInIsolatedContext(
              'GraphBuilder.doAddModuleDependency',
              `${href}|${dependency.spec}`,
              (ctx) => this.doAddModuleDependency(ctx, sourceModule, dependency)
            );
          }
        }
      },
      (err) => {
        this.pendingModuleOperations.delete(href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(href, operation);
  }

  private doAddUnresolvedUri(ctx: ResolverContext, uri: Uri, dependency: SourceModuleDependency) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext('addUnresolvedUri', uri, (ctx) =>
      addUnresolvedUri(ctx, uri)
    );

    operation.then(
      (resolveResult) => {
        this.pendingModuleOperations.delete(href, operation);

        this.addEdge(this.rootUri, resolveResult.uri, resolveResult.visited, dependency);

        ctx.runInChildContext('GraphBuilder.doAddResolvedUri', resolveResult.uri, (ctx) =>
          this.doAddResolvedUri(
            ctx,
            resolveResult.uri,
            resolveResult.rootUri,
            resolveResult.parentPackageJson
          )
        );
      },
      (err) => {
        this.pendingModuleOperations.delete(href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(href, operation);
  }

  private getParserForUri(uri: Uri): ParserFunction {
    const path = uri.path;

    if (path.endsWith('.json')) {
      return parseJson;
    }

    if (path.endsWith('.js')) {
      return parseJavaScript;
    }

    throw new ParseError(uri, 'No suitable parser was found');
  }
}

async function addUnresolvedUri(ctx: ResolverContext, uri: Uri) {
  const resolveResult = await ctx.resolve(uri);

  if (!resolveResult.found) {
    throw new EntryNotFoundError(`Entry point not found: ${uri}`);
  }

  if (!resolveResult.uri) {
    throw new EntryExcludedError(uri);
  }

  return resolveResult;
}

async function readFileContent(ctx: ResolverContext, uri: Uri) {
  return ctx.readFileContent(uri);
}

async function resolveDependency(
  ctx: ResolverContext,
  sourceModule: SourceModule,
  dependency: SourceModuleDependency
) {
  const parsedSpec = parseBareModuleSpec(dependency.spec);

  return parsedSpec
    ? ctx.runInChildContext('resolveBareModule', sourceModule.uri, (ctx) =>
        resolveBareModule(ctx, sourceModule, parsedSpec, dependency)
      )
    : ctx.runInChildContext('resolveRelativeUri', sourceModule.uri, (ctx) =>
        resolveRelativeUri(ctx, sourceModule, dependency.spec)
      );
}

async function resolveRelativeUri(
  ctx: ResolverContext,
  sourceModule: SourceModule,
  pathname: string
) {
  const uri = Uri.joinPath(
    Uri.from({
      ...sourceModule.uri,
      path: dirname(sourceModule.uri.path),
    }),
    pathname
  );
  const resolveReturn = ctx.resolve(uri);
  const resolveResult = isThenable(resolveReturn)
    ? await checkCancellation(resolveReturn, ctx.token)
    : resolveReturn;

  if (!resolveResult.found) {
    throw new DependencyNotFoundError(pathname, sourceModule);
  }

  if (!resolveResult.uri) {
    // TODO: Inject empty module
    throw new EntryExcludedError(pathname);
  }

  return {
    uri: resolveResult.uri,
    parentPackageJson: resolveResult.parentPackageJson,
    rootUri: resolveResult.rootUri,
    visited: resolveResult.visited,
  };
}

async function resolveBareModule(
  ctx: ResolverContext,
  sourceModule: SourceModule,
  parsedSpec: BareModuleSpec,
  dependency: SourceModuleDependency
) {
  let locatorName = parsedSpec.name;
  let locatorSpec = parsedSpec.spec;
  let locatorPath = parsedSpec.path;

  if (!locatorSpec) {
    const parentPackageJsonReturn = ctx.readParentPackageJson(sourceModule.uri);
    const parentPackageJsonResult = isThenable(parentPackageJsonReturn)
      ? await checkCancellation(parentPackageJsonReturn, ctx.token)
      : parentPackageJsonReturn;

    if (!parentPackageJsonResult.found) {
      throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
    }

    const dependencies = {
      ...(parentPackageJsonResult.packageJson.devDependencies || {}),
      ...(parentPackageJsonResult.packageJson.peerDependencies || {}),
      ...(parentPackageJsonResult.packageJson.dependencies || {}),
    };

    locatorSpec = dependencies[parsedSpec.name];
  }

  if (!locatorSpec) {
    const builtIn = NODE_CORE_SHIMS[parsedSpec.name];

    if (builtIn) {
      locatorName = builtIn.name;
      locatorSpec = builtIn.spec;
      locatorPath = builtIn.path;
    }
  }

  if (!locatorSpec) {
    throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
  }

  dependency.locator = { name: locatorName, spec: locatorSpec, path: locatorPath };

  const bareModuleUriReturn = ctx.getUrlForBareModule(locatorName, locatorSpec, locatorPath);
  const bareModuleUriResult = isThenable(bareModuleUriReturn)
    ? await checkCancellation(bareModuleUriReturn, ctx.token)
    : bareModuleUriReturn;

  if (!bareModuleUriResult.found) {
    throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
  }

  if (!bareModuleUriResult.uri) {
    // TODO: Inject empty module
    throw new EntryExcludedError(parsedSpec.nameSpec);
  }

  const resolveReturn = ctx.resolve(bareModuleUriResult.uri);
  const resolveResult = isThenable(resolveReturn)
    ? await checkCancellation(resolveReturn, ctx.token)
    : resolveReturn;

  if (resolveResult.parentPackageJson) {
    dependency.locator.version = resolveResult.parentPackageJson.packageJson.version;
  }

  if (!resolveResult.found) {
    throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
  }

  if (!resolveResult.uri) {
    // TODO: Inject empty module
    throw new EntryExcludedError(parsedSpec.nameSpec);
  }

  return {
    uri: resolveResult.uri,
    rootUri: resolveResult.rootUri,
    visited: resolveResult.visited,
    parentPackageJson: resolveResult.parentPackageJson,
  };
}
