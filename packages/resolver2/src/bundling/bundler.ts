import MagicString from 'magic-string';
import { dirname, DisposableStore, Emitter } from 'ts-primitives';
import { checkCancellation, isThenable } from '../async';
import { ResolverContext, Visit } from '../context';
import {
  BuildError,
  DependencyNotFoundError,
  EntryExcludedError,
  EntryNotFoundError,
  isCanceledError,
  ParseError,
} from '../error';
import { Resolver } from '../resolver';
import { Uri } from '../uri';
import { BareModuleSpec, parseBareModuleSpec } from './bareModules';
import { MapSet } from './mapSet';
import { ParserFunction } from './parsing';
import { DEFAULT_SHIM_GLOBALS, NODE_CORE_SHIMS } from './shims';
import { parseJavaScript, parseJson } from './source';
import { SourceModule } from './sourceModule';
import { SourceModuleDependency } from './sourceModuleDependency';

type DependencyEdge = {
  dependency: SourceModuleDependency;
  fromUri: Uri;
  toUri: Uri;
  visited: Visit[];
};

interface BundleOptions {
  entrypoints: Uri[];
  resolver: Resolver;
  nodeEnv?: string;
}

class Graph {
  constructor(
    readonly edgesTo: MapSet<string, DependencyEdge>,
    readonly edgesFrom: MapSet<string, DependencyEdge>,
    readonly entrypoints: Uri[],
    readonly sourceModules: Map<string, SourceModule>
  ) {}
}

class Bundle {
  private readonly disposer = new DisposableStore();
  private readonly edgesTo = new MapSet<string, DependencyEdge>();
  private readonly edgesFrom = new MapSet<string, DependencyEdge>();
  private readonly entrypoints: Uri[];
  private readonly errors = [] as { ctx: ResolverContext; err: Error }[];
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly rootUri = Uri.parse('velcro:///root');
  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly sourceModules = new Map<string, SourceModule>();

  private readonly onErrorEmitter = new Emitter<{ ctx: ResolverContext; err: Error }>();

  constructor(options: BundleOptions) {
    this.resolver = options.resolver;
    this.entrypoints = options.entrypoints.map(Uri.from);
    this.nodeEnv = options.nodeEnv || 'development';

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

  async build() {
    const disposer = new DisposableStore();
    this.disposer.add(disposer);

    const rootCtx = this.resolver.createResolverContext();
    disposer.add(rootCtx);

    const evt = this.onError(() => {
      disposer.dispose();
    });
    disposer.add(evt);

    for (const uri of this.entrypoints) {
      rootCtx.runInChildContext('Bundle.addUnresolvedUri', uri, (ctx) =>
        this.addUnresolvedUri(ctx, uri, SourceModuleDependency.fromEntrypoint(uri))
      );
    }

    try {
      // Flush the queue
      while (this.pendingModuleOperations.size) {
        await Promise.all(this.pendingModuleOperations.values());
      }
    } catch {
      throw this.buildError(this.errors);
    }

    return new Graph(this.edgesTo, this.edgesFrom, this.entrypoints, this.sourceModules);
  }

  private addEdge(fromUri: Uri, toUri: Uri, visited: Visit[], dependency: SourceModuleDependency) {
    const edge = { dependency, fromUri, toUri, visited };

    this.edgesFrom.add(fromUri.toString(), edge);
    this.edgesTo.add(toUri.toString(), edge);
  }

  private addModuleDependency(
    ctx: ResolverContext,
    sourceModule: SourceModule,
    dependency: SourceModuleDependency
  ) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const operation = ctx.runInChildContext(
      'Bundle.resolveDependency',
      `${sourceModule.href}|${dependency.spec}`,
      (ctx) => this.resolveDependency(ctx, sourceModule, dependency)
    );

    operation.then(
      () => {
        this.pendingModuleOperations.delete(sourceModule.href, operation);
      },
      (err) => {
        this.pendingModuleOperations.delete(sourceModule.href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(sourceModule.href, operation);
  }

  private addResolvedUri(ctx: ResolverContext, uri: Uri, rootUri: Uri) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    ctx.runInChildContext('Bundle.readSourceAndCreateModule', uri, (ctx) =>
      this.readSourceAndCreateModule(ctx, uri, rootUri)
    );
  }

  private addUnresolvedUri(ctx: ResolverContext, uri: Uri, dependency: SourceModuleDependency) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext('Bundle.addUnresolvedUriImpl', uri, (ctx) =>
      this.addUnresolvedUriImpl(ctx, uri, dependency)
    );

    operation.then(
      () => {
        this.pendingModuleOperations.delete(href, operation);
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

  private async addUnresolvedUriImpl(
    ctx: ResolverContext,
    uri: Uri,
    dependency: SourceModuleDependency
  ) {
    const resolveResult = await ctx.resolve(uri);

    if (!resolveResult.found) {
      throw new EntryNotFoundError(`Entry point not found: ${uri}`);
    }

    if (!resolveResult.uri) {
      throw new EntryExcludedError(uri);
    }

    this.addEdge(this.rootUri, resolveResult.uri, resolveResult.visited, dependency);
    this.addResolvedUri(ctx, resolveResult.uri, resolveResult.rootUri);
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

  private buildError(errors: { err: Error; ctx: ResolverContext }[]) {
    return new BuildError(errors);
  }

  private readSourceAndCreateModule(ctx: ResolverContext, uri: Uri, rootUri: Uri) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = ctx.runInChildContext('Bundle.readSourceAndCreateModuleImpl', uri, (ctx) =>
      this.readSourceAndCreateModuleImpl(ctx, uri, rootUri)
    );

    operation.then(
      () => {
        this.pendingModuleOperations.delete(href, operation);
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

  private async readSourceAndCreateModuleImpl(ctx: ResolverContext, uri: Uri, rootUri: Uri) {
    const href = uri.toString();
    const contentReturn = ctx.readFileContent(uri);
    const contentResult = isThenable(contentReturn)
      ? await checkCancellation(contentReturn, ctx.token)
      : contentReturn;
    const parser = this.getParserForUri(uri);
    // console.time(`parseFile(${href})`);

    const { code, dependencies, syntax } = ctx.runInChildContext(
      `parse[${parser.name}]`,
      uri,
      (ctx) =>
        parser(ctx, uri, contentResult.content, {
          environmentModules: NODE_CORE_SHIMS,
          globalModules: DEFAULT_SHIM_GLOBALS,
          nodeEnv: this.nodeEnv,
        })
    );
    // console.timeEnd(`parseFile(${href})`);

    const sourceModule = new SourceModule(
      uri,
      rootUri,
      new MagicString(code, { filename: href, indentExclusionRanges: [] }),
      syntax,
      new Set(dependencies)
    );
    this.sourceModules.set(sourceModule.href, sourceModule);

    for (const dependency of sourceModule.dependencies) {
      ctx.runInIsolatedContext('Bundle.addModuleDependency', `${href}|${dependency.spec}`, (ctx) =>
        this.addModuleDependency(ctx, sourceModule, dependency)
      );
    }
  }

  private async resolveDependency(
    ctx: ResolverContext,
    sourceModule: SourceModule,
    dependency: SourceModuleDependency
  ) {
    const parsedSpec = parseBareModuleSpec(dependency.spec);
    const resolveReturn = parsedSpec
      ? ctx.runInChildContext('Bundle.resolveBareModule', sourceModule.uri, (ctx) =>
          this.resolveBareModule(ctx, sourceModule, parsedSpec)
        )
      : ctx.runInChildContext('Bundle.resolveRelativeUri', sourceModule.uri, (ctx) =>
          this.resolveRelativeUri(ctx, sourceModule, dependency.spec)
        );
    const resolveResult = isThenable(resolveReturn)
      ? await checkCancellation(resolveReturn, ctx.token)
      : resolveReturn;

    // sourceModule.setUriForDependency(dependency, resolveResult.uri);

    const href = resolveResult.uri.toString();

    // To avoid circularity
    if (this.sourceModules.has(href)) {
      return;
    }

    // If we already have pending operations for the same Uri, we can
    // assume that the module either already exists or soon will and
    // should not be re-read.
    if (this.pendingModuleOperations.has(href)) {
      return;
    }

    this.addEdge(sourceModule.uri, resolveResult.uri, resolveResult.visited, dependency);

    ctx.runInChildContext('Bundle.addResolvedUri', resolveResult.uri, (ctx) =>
      this.addResolvedUri(ctx, resolveResult.uri, resolveResult.rootUri)
    );
  }

  private async resolveRelativeUri(
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
      rootUri: resolveResult.rootUri,
      visited: resolveResult.visited,
    };
  }

  private async resolveBareModule(
    ctx: ResolverContext,
    sourceModule: SourceModule,
    parsedSpec: BareModuleSpec
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
        ...(parentPackageJsonResult.packageJson.peerDependencies || {}),
        ...(parentPackageJsonResult.packageJson.devDependencies || {}),
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
    };
  }
}

interface CreateBundleOptions {
  entrypoints: Uri[];
  resolver: Resolver;
  nodeEnv?: string;
}
export function createBundle(options: CreateBundleOptions) {
  const bundle = new Bundle(options);

  return bundle.build();
}
