import {
  CancellationToken,
  CancellationTokenSource,
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
import { Graph } from './graph';
import { DEFAULT_SHIM_GLOBALS } from './shims';
import { SourceModule } from './sourceModule';
import { SourceModuleDependency } from './sourceModuleDependency';

type ExternalTestFunction = (
  dependency: SourceModuleDependency,
  fromSourceModule: SourceModule
) => boolean;

export class Build {
  private readonly disposer = new DisposableStore();
  private readonly edges = new Set<DependencyEdge>();
  readonly errors: Error[] = [];
  readonly seen = new Set<unknown>();
  private readonly sourceModules = new Map<string, SourceModule>();

  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly tokenSource: CancellationTokenSource;

  private readonly onCompletedEmitter = new Emitter<{ graph: Graph }>();
  private readonly onErrorEmitter = new Emitter<{ error: Error }>();
  private readonly onProgressEmitter = new Emitter<{
    progress: {
      completed: number;
      pending: number;
    };
  }>();

  readonly done = new Promise<Graph>((resolve, reject) => {
    this.disposer.add(this.onCompleted(({ graph }) => resolve(graph)));
    this.disposer.add(this.onError(({ error }) => reject(error)));
  });

  constructor(readonly rootUri: Uri, options: { token?: CancellationToken } = {}) {
    this.tokenSource = new CancellationTokenSource(options.token);

    this.disposer.add(this.tokenSource);
  }

  get onCompleted(): Event<{ graph: Graph }> {
    return this.onCompletedEmitter.event;
  }

  get onError(): Event<{ error: Error }> {
    return this.onErrorEmitter.event;
  }

  get onProgress(): Event<{
    progress: {
      completed: number;
      pending: number;
    };
  }> {
    return this.onProgressEmitter.event;
  }

  get token() {
    return this.tokenSource.token;
  }

  addEdge(edge: DependencyEdge) {
    this.edges.add(edge);
  }

  addSourceModule(sourceModule: SourceModule) {
    this.sourceModules.set(sourceModule.href, sourceModule);
  }

  cancel() {
    this.tokenSource.cancel();
  }

  dispose() {
    this.cancel();
    this.disposer.dispose();
  }

  hasSourceModule(href: string) {
    return this.sourceModules.has(href);
  }

  runAsync(key: string, fn: () => Promise<unknown>): void {
    if (this.token.isCancellationRequested) {
      return;
    }

    const onError = (err: Error) => {
      if (ret) {
        this.pendingModuleOperations.delete(key, ret);
      }
      this.cancel();

      if (!isCanceledError(err)) {
        this.errors.push(err);

        this.onErrorEmitter.fire({ error: err });
      }
    };
    const onSuccess = () => {
      this.pendingModuleOperations.delete(key, ret);

      if (!this.pendingModuleOperations.size) {
        this.onCompletedEmitter.fire({
          graph: new Graph({
            edges: this.edges,
            rootUri: this.rootUri,
            sourceModules: this.sourceModules.values(),
          }),
        });
      } else {
        this.onProgressEmitter.fire({
          progress: {
            completed: this.sourceModules.size,
            pending: this.pendingModuleOperations.size,
          },
        });
      }
    };

    let ret: ReturnType<typeof fn>;

    try {
      ret = fn().then(onSuccess, onError);
      this.pendingModuleOperations.add(key, ret);
    } catch (err) {
      onError(err);
    }
  }
}

export class GraphBuilder {
  private readonly edgesByDependency = new WeakMap<SourceModuleDependency, DependencyEdge>();
  private readonly edgesByInvalidation = new MapSet<string, DependencyEdge>();
  private readonly external?: ExternalTestFunction;
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly pluginManager: PluginManager;
  private readonly sourceModules = new Map<string, SourceModule>();
  private readonly sourceModulesByInvalidation = new MapSet<string, SourceModule>();

  constructor(options: GraphBuilder.Options) {
    this.resolver = options.resolver;
    this.external = options.external;
    this.nodeEnv = options.nodeEnv || 'development';
    this.pluginManager = new PluginManager(options.plugins || []);
  }

  private loadDependency(build: Build, sourceModule: SourceModule, dep: SourceModuleDependency) {
    if (build.seen.has(dep)) return;
    build.seen.add(dep);

    if (this.external && this.external(dep, sourceModule)) {
      return;
    }

    // console.debug('loadDependency(%s, %s)', sourceModule.href, dep.spec);

    build.runAsync(`${sourceModule.href}|${dep.spec}`, async () => {
      const result = await this.pluginManager.executeResolveDependency(
        {
          nodeEnv: this.nodeEnv,
          resolver: this.resolver,
          token: build.token,
        },
        dep,
        sourceModule
      );
      const edge = this.createEdge(
        sourceModule.uri,
        sourceModule.rootUri,
        result.uri,
        result.rootUri,
        result.visited,
        dep
      );

      build.addEdge(edge);

      this.loadEdge(build, edge);
    });
  }

  private loadEdge(build: Build, edge: DependencyEdge) {
    const href = edge.toUri.toString();

    if (build.hasSourceModule(href)) return;

    const existingSourceModule = this.sourceModules.get(href);

    if (existingSourceModule) {
      build.addSourceModule(existingSourceModule);

      return this.visitSourceModule(build, existingSourceModule);
    }

    // console.debug(
    //   'loadEdge(%s, %s, %s)',
    //   edge.fromUri.toString(),
    //   edge.dependency.spec,
    //   edge.toUri.toString()
    // );

    build.runAsync(href, async () => {
      // We need to check again in case another 'thread' already produced this
      // sourceModule
      if (build.hasSourceModule(href)) return;

      const loadResult = await this.pluginManager.executeLoad(
        {
          nodeEnv: this.nodeEnv,
          resolver: this.resolver,
          token: build.token,
        },
        edge.toUri
      );

      // We need to check again in case another 'thread' already produced this
      // sourceModule
      if (build.hasSourceModule(href)) return;

      const transformResult = await this.pluginManager.executeTransform(
        {
          nodeEnv: this.nodeEnv,
          resolver: this.resolver,
          token: build.token,
        },
        edge.toUri,
        loadResult.code
      );

      // We need to check again in case another 'thread' already produced this
      // sourceModule
      if (build.hasSourceModule(href)) return;

      const parseResult = parse(edge.toUri, transformResult.code, {
        globalModules: DEFAULT_SHIM_GLOBALS,
        nodeEnv: this.nodeEnv,
      });
      const sourceModule = new SourceModule(
        edge.toUri,
        edge.toRootUri,
        parseResult.code,
        new Set(parseResult.dependencies),
        transformResult.sourceMapTree,
        [...transformResult.visited, ...loadResult.visited]
      );

      build.addSourceModule(sourceModule);
      this.sourceModules.set(sourceModule.href, sourceModule);

      for (const visit of sourceModule.visits) {
        this.sourceModulesByInvalidation.add(visit.uri.toString(), sourceModule);
      }

      this.sourceModulesByInvalidation.add(sourceModule.href, sourceModule);

      this.visitSourceModule(build, sourceModule);
    });
  }

  private loadEntrypoint(build: Build, uri: Uri) {
    const href = uri.toString();

    // console.debug('loadEntrypoint(%s)', href);
    build.runAsync(href, async () => {
      const result = await this.pluginManager.executeResolveEntrypoint(
        {
          nodeEnv: this.nodeEnv,
          resolver: this.resolver,
          token: build.token,
        },
        uri
      );
      const edge = this.createEdge(
        build.rootUri,
        build.rootUri,
        result.uri,
        result.rootUri,
        result.visited,
        SourceModuleDependency.fromEntrypoint(uri)
      );

      this.loadEdge(build, edge);
    });
  }

  private visitSourceModule(build: Build, sourceModule: SourceModule) {
    if (build.seen.has(sourceModule)) return;
    build.seen.add(sourceModule);

    // console.debug('visitSourceModule(%s)', sourceModule.href);
    for (const dep of sourceModule.dependencies) {
      const existingEdge = this.edgesByDependency.get(dep);

      if (existingEdge) {
        build.addEdge(existingEdge);

        this.loadEdge(build, existingEdge);
      } else {
        this.loadDependency(build, sourceModule, dep);
      }
    }
  }

  build(
    entrypoints: (string | Uri)[],
    options: { incremental?: boolean; token?: CancellationToken } = {}
  ) {
    const rootUri = Uri.parse('velcro:/');
    const build = new Build(rootUri, { token: options.token });

    for (const uri of entrypoints) {
      this.loadEntrypoint(build, Uri.isUri(uri) ? uri : Uri.parse(uri));
    }

    return build;
  }

  invalidate(uri: Uri | string) {
    const href = Uri.isUri(uri) ? uri.toString() : uri;
    const sourceModules = this.sourceModulesByInvalidation.get(href);

    if (sourceModules) {
      for (const sourceModule of sourceModules) {
        this.sourceModules.delete(sourceModule.href);
      }
      this.sourceModulesByInvalidation.deleteAll(href);
    }

    this.sourceModules.delete(href);

    const edges = this.edgesByInvalidation.get(href);

    if (edges) {
      for (const edge of edges) {
        this.edgesByDependency.delete(edge.dependency);
      }
      this.edgesByInvalidation.deleteAll(href);
    }

    this.resolver.invalidate(uri);
  }

  private createEdge(
    fromUri: Uri,
    fromRootUri: Uri,
    toUri: Uri,
    toRootUri: Uri,
    visited: ResolverContext.Visit[],
    dependency: SourceModuleDependency
  ) {
    const edge = { dependency, fromUri, fromRootUri, toUri, toRootUri, visited };

    this.edgesByDependency.set(dependency, edge);

    this.edgesByInvalidation.add(toUri.toString(), edge);
    for (const visit of visited) {
      this.edgesByInvalidation.add(visit.uri.toString(), edge);
    }

    return edge;
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
