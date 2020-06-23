import {
  CancellationToken,
  DisposableStore,
  Emitter,
  Event,
  isCanceledError,
  MapSet,
  Uri,
} from '@velcro/common';
import { Resolver, ResolverContext } from '@velcro/resolver';
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

export class GraphBuilder {
  private readonly disposer = new DisposableStore();
  private readonly edges = new Set<DependencyEdge>();
  private readonly edgesByFromHref = new MapSet<string, DependencyEdge>();
  private readonly edgesByInvalidation = new MapSet<string, DependencyEdge>();
  private readonly errors = [] as { ctx: { path: readonly string[] }; err: Error }[];
  private readonly external?: ExternalTestFunction;
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly rootCtx: ResolverContext;
  private readonly rootUri = Uri.parse('velcro:/root');
  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly pluginManager: PluginManager;
  private readonly sourceModules = new Map<string, SourceModule>();
  private readonly sourceModulesByInvalidation = new MapSet<string, SourceModule>();

  private readonly onErrorEmitter = new Emitter<{ ctx: ResolverContext; err: Error }>();

  constructor(options: GraphBuilder.Options) {
    this.resolver = options.resolver;
    this.rootCtx = this.resolver.rootCtx;
    this.external = options.external;
    this.nodeEnv = options.nodeEnv || 'development';
    this.pluginManager = new PluginManager(options.plugins || [], {
      nodeEnv: this.nodeEnv,
    });

    this.disposer.add(this.rootCtx);
    this.disposer.add(
      this.onError((event) => {
        this.errors.push(event);
      })
    );
  }

  get onError(): Event<{ ctx: ResolverContext; err: Error }> {
    return this.onErrorEmitter.event;
  }

  dispose() {
    this.disposer.dispose();
  }

  async buildGraph(entrypoints: Uri[], options: { token?: CancellationToken } = {}) {
    const entrypointHrefs = entrypoints.map((entrypoint) => entrypoint.toString());
    const ctx = this.rootCtx.forOperation('GraphBuilder.buildGraph', entrypointHrefs.join(','), {
      resetPath: true,
      resetVisits: true,
    });

    this.onError(() => ctx.dispose());

    if (options.token) {
      if (options.token.isCancellationRequested) {
        ctx.dispose();
      }

      options.token.onCancellationRequested(() => ctx.dispose());
    }

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

  invalidate(uri: Uri | string) {
    const href = Uri.isUri(uri) ? uri.toString() : uri;

    const edges = this.edgesByInvalidation.get(href);
    if (edges) {
      for (const edge of edges) {
        this.edgesByInvalidation.delete(href, edge);
        this.edges.delete(edge);
      }
    }

    const sourceModules = this.sourceModulesByInvalidation.get(href);
    if (sourceModules) {
      for (const sourceModule of sourceModules) {
        this.sourceModulesByInvalidation.delete(href, sourceModule);
        this.sourceModules.delete(sourceModule.href);
      }
    }

    this.resolver.invalidate(uri);
  }

  private addEdge(
    fromUri: Uri,
    fromRootUri: Uri,
    toUri: Uri,
    toRootUri: Uri,
    visited: ResolverContext.Visit[],
    dependency: SourceModuleDependency
  ) {
    const edge: DependencyEdge = { dependency, fromUri, fromRootUri, toUri, toRootUri, visited };

    this.edges.add(edge);
    this.edgesByFromHref.add(fromUri.toString(), edge);

    for (const visit of visited) {
      this.edgesByInvalidation.add(visit.uri.toString(), edge);
    }
    this.edgesByInvalidation.add(fromUri.toString(), edge);
    this.edgesByInvalidation.add(toUri.toString(), edge);

    return edge;
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
          transformResult.sourceMapTree,
          transformResult.visited
        );

        this.sourceModules.set(sourceModule.href, sourceModule);
        for (const visit of transformResult.visited) {
          this.sourceModulesByInvalidation.add(visit.uri.toString(), sourceModule);
        }
        this.sourceModulesByInvalidation.add(sourceModule.href, sourceModule);

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

    const withEdge = (edge: DependencyEdge) => {
      const dependencyHref = edge.toUri.toString();

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

      ctx.runInChildContext('GraphBuilder.doAddResolvedUri', edge.toUri, (ctx) =>
        this.doAddResolvedUri(ctx, edge.toUri, edge.toRootUri)
      );
    };

    // const edgesFrom = this.edgesByFromHref.get(sourceModule.href);

    // if (edgesFrom) {
    //   for (const edge of edgesFrom) {
    //     if (SourceModuleDependency.areIdentical(edge.dependency, dependency)) {
    //       console.log('withEdge', sourceModule.href, edge.dependency.kind, edge.dependency.spec, sourceModule);
    //       edge.dependency = dependency;
    //       return withEdge(edge);
    //     }
    //   }
    // }

    const href = sourceModule.href;
    const operation = ctx.runInChildContext(
      'GraphBuilder.pluginManager.executeResolveDependency',
      `${href}|${dependency.spec}`,
      (ctx) => this.pluginManager.executeResolveDependency(ctx, dependency, sourceModule)
    );

    operation.then(
      (resolveResult) => {
        this.pendingModuleOperations.delete(href, operation);

        const edge = this.addEdge(
          sourceModule.uri,
          sourceModule.rootUri,
          resolveResult.uri,
          resolveResult.rootUri,
          resolveResult.visited,
          dependency
        );

        withEdge(edge);
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

        this.addEdge(
          this.rootUri,
          this.rootUri,
          resolveResult.uri,
          resolveResult.rootUri,
          resolveResult.visited,
          dependency
        );

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

export namespace GraphBuilder {
  export interface Options {
    external?: ExternalTestFunction;
    nodeEnv?: string;
    plugins?: Plugin[];
    resolver: Resolver;
  }
}
