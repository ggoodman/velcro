import { isCanceledError, MapSet, Uri } from '@velcro/common';
import { Resolver, ResolverContext } from '@velcro/resolver';
import { DisposableStore, Emitter } from 'ts-primitives';
import { Plugin, PluginManager } from '../plugins';
import { parse } from './commonjs';
import { DependencyEdge } from './dependencyEdge';
import { GraphBuildError } from './errors';
import { Graph } from './graph';
import { DEFAULT_SHIM_GLOBALS } from './shims';
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
  plugins?: Plugin[];
  resolver: Resolver;
}

export function buildGraph(options: BuildGraphOptions) {
  const graphBuilder = new GraphBuilder({
    external: options.external,
    nodeEnv: options.nodeEnv || 'development',
    plugins: options.plugins || [],
    resolver: options.resolver,
  });

  return graphBuilder.buildGraph(options.entrypoints);
}

namespace GraphBuilder {
  export interface Options {
    external?: ExternalTestFunction;
    nodeEnv?: string;
    plugins: Plugin[];
    resolver: Resolver;
  }
}

class GraphBuilder {
  private readonly disposer = new DisposableStore();
  private readonly edges = new Set<DependencyEdge>();
  private readonly errors = [] as { ctx: { path: readonly string[] }; err: Error }[];
  private readonly external?: ExternalTestFunction;
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly rootCtx: ResolverContext;
  private readonly rootUri = Uri.parse('velcro:/root');
  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly pluginManager: PluginManager;
  private readonly sourceModules = new Map<string, SourceModule>();

  private readonly onErrorEmitter = new Emitter<{ ctx: ResolverContext; err: Error }>();

  constructor(options: GraphBuilder.Options) {
    this.resolver = options.resolver;
    this.rootCtx = this.resolver.createResolverContext();
    this.external = options.external;
    this.nodeEnv = options.nodeEnv || 'development';
    this.pluginManager = new PluginManager(options.plugins);

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

  private addEdge(
    fromUri: Uri,
    toUri: Uri,
    visited: ResolverContext.Visit[],
    dependency: SourceModuleDependency
  ) {
    this.edges.add({ dependency, fromUri, toUri, visited });
  }

  private doAddLoadedUri(ctx: ResolverContext, uri: Uri, rootUri: Uri, code: string) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext(
      'GraphBuilder.pluginManager.executeTransform',
      href,
      (ctx) => this.pluginManager.executeTransform(ctx, uri, code)
    );

    operation.then(
      (transformResult) => {
        this.pendingModuleOperations.delete(href, operation);

        const parseResult = parse(uri, transformResult.code, {
          globalModules: DEFAULT_SHIM_GLOBALS,
          nodeEnv: this.nodeEnv,
        });

        const sourceModule = new SourceModule(
          uri,
          rootUri,
          parseResult.code,
          new Set(parseResult.dependencies),
          transformResult.sourceMaps,
          transformResult.visited
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
      'GraphBuilder.pluginManager.executeResolveDependency',
      `${href}|${dependency.spec}`,
      (ctx) => this.pluginManager.executeResolveDependency(ctx, dependency, sourceModule)
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
          this.doAddResolvedUri(ctx, resolveResult.uri, resolveResult.rootUri)
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

  private doAddResolvedUri(ctx: ResolverContext, uri: Uri, rootUri: Uri) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext('GraphBuilder.pluginManager.executeLoad', uri, (ctx) =>
      this.pluginManager.executeLoad(ctx, uri)
    );

    operation.then(
      (loadResult) => {
        this.pendingModuleOperations.delete(href, operation);

        ctx.runInChildContext('GraphBuilder.doAddLoadedUri', uri, (ctx) =>
          this.doAddLoadedUri(ctx, uri, rootUri, loadResult.code)
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

  private doAddUnresolvedUri(ctx: ResolverContext, uri: Uri, dependency: SourceModuleDependency) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext(
      'GraphBuilder.pluginManager.executeResolveEntrypoint',
      uri,
      (ctx) => this.pluginManager.executeResolveEntrypoint(ctx, uri)
    );

    operation.then(
      (resolveResult) => {
        this.pendingModuleOperations.delete(href, operation);

        this.addEdge(this.rootUri, resolveResult.uri, resolveResult.visited, dependency);

        ctx.runInChildContext('GraphBuilder.doAddResolvedUri', resolveResult.uri, (ctx) =>
          this.doAddResolvedUri(ctx, resolveResult.uri, resolveResult.rootUri)
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
}
