import {
  all,
  Awaited,
  basename,
  CanceledError,
  CancellationToken,
  CancellationTokenSource,
  checkCancellation,
  Decoder,
  DependencyNotFoundError,
  dirname,
  EntryExcludedError,
  EntryNotFoundError,
  isThenable,
  MapSet,
  PackageJson,
  parseBufferAsPackageJson,
  parseBufferAsPartialPackageJson,
  PartialPackageJson,
  Thenable,
  Uri,
} from '@velcro/common';
import { BareModuleSpec, parseBareModuleSpec } from './bareModules';
import type { Resolver } from './resolver';
import { NODE_CORE_SHIMS } from './shims';
import { ResolverStrategy } from './strategy';

type ReturnTypeWithVisits<
  T extends (...args: any[]) => any,
  TReturn = ReturnType<T>
> = TReturn extends Thenable<infer U>
  ? Promise<U & { visited: ResolverContext.Visit[] }>
  : TReturn & { visited: ResolverContext.Visit[] };

// type UncachedReturnType<T> = { [K in keyof T] : K extends typeof CACHE ? never : T[K] };
// type UncachedReturn<
//   T extends (...any: any[]) => any,
//   TReturn = ReturnType<T>
// > = TReturn extends Thenable<infer U>
//   ? Thenable<UncachedReturnType<U>>
//   : UncachedReturnType<TReturn>;

const CACHE = Symbol('Context.cache');

type InvalidationRecord = {
  cacheKey: string;
  operationCache: Map<string, unknown>;
};

type ResolveResult =
  | {
      found: false;
      uri: null;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
    }
  | {
      found: true;
      uri: null;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
      rootUri: Uri;
    }
  | {
      found: true;
      uri: Uri;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
      rootUri: Uri;
    };

type ReadParentPackageJsonResultInternal =
  | {
      found: true;
      packageJson: PackageJson;
      uri: Uri;
      visitedDirs: Uri[];
    }
  | {
      found: false;
      packageJson: null;
      uri: null;
    };

type StrategyResult<T> =
  | Promise<T & { visited: ResolverContext.Visit[] }>
  | (T & { visited: ResolverContext.Visit[] });

class Visits {
  private readonly parent?: Visits;
  private readonly visits = [] as ResolverContext.Visit[];

  constructor(readonly uri: { toString(): string }, parent?: Visits) {
    this.parent = parent;
  }

  child(uri: { toString(): string }): Visits {
    return new Visits(uri, this);
  }

  push(visit: ResolverContext.Visit) {
    if (!this.visits.find((cmp) => cmp.type == visit.type && Uri.equals(cmp.uri, visit.uri))) {
      this.visits.push(visit);
      if (this.parent) {
        this.parent.push(visit);
      }
    }
  }

  toArray(): ResolverContext.Visit[] {
    return this.parent ? this.parent.toArray() : this.visits.slice();
  }
}

export class ResolverContext {
  static create(
    resolver: Resolver,
    strategy: ResolverStrategy,
    settings: Resolver.Settings,
    token: CancellationToken,
    options: { debug?: boolean } = {}
  ) {
    return new ResolverContext({
      cache: new Map(),
      cacheInvalidations: new MapSet(),
      debug: !!options.debug,
      decoder: new Decoder(),
      path: [],
      resolver,
      settings,
      strategy,
      token,
      visits: new Visits(Uri.parse('velcro:/root')),
    });
  }

  private readonly cache: ResolverContext.Options['cache'];
  private readonly cacheInvalidations: ResolverContext.Options['cacheInvalidations'];
  private readonly debugMode: boolean;
  readonly decoder: ResolverContext.Options['decoder'];
  private readonly mapResultWithVisits = <T>(result: T) =>
    Object.assign(result, { visited: this.visits.toArray() });
  readonly path: ReadonlyArray<string>;
  private readonly resolver: ResolverContext.Options['resolver'];
  readonly settings: Readonly<ResolverContext.Options['settings']>;
  private readonly strategy: ResolverContext.Options['strategy'];
  private readonly tokenSource: CancellationTokenSource;
  private readonly visits: Visits;

  protected constructor(options: ResolverContext.Options) {
    this.cache = options.cache;
    this.cacheInvalidations = options.cacheInvalidations;
    this.debugMode = options.debug;
    this.decoder = options.decoder;
    this.path = options.path;
    this.resolver = options.resolver;
    this.settings = options.settings;
    this.strategy = options.strategy;
    this.tokenSource = new CancellationTokenSource(options.token);
    this.visits = options.visits;
  }

  get token() {
    return this.tokenSource.token;
  }

  get visited() {
    return this.visits.toArray();
  }

  dispose() {
    this.tokenSource.dispose(true);
  }

  forOperation(
    operationName: string,
    uri: { toString(): string },
    options: { resetPath?: boolean; resetVisits?: boolean } = {}
  ) {
    const encodedOperation = encodePathNode(operationName, uri);

    if (this.path.includes(encodedOperation)) {
      const formattedPath = this.path
        .map((segment) => {
          const { operationName, uri } = decodePathNode(segment);

          return `${operationName}(${uri.toString()})`;
        })
        .join(' -> ');

      throw this._wrapError(
        new Error(
          `Detected a recursive call to the operation '${operationName}' for '${uri.toString()}' at path '${formattedPath}'`
        )
      );
    }

    return new ResolverContext({
      cache: this.cache,
      cacheInvalidations: this.cacheInvalidations,
      debug: this.debugMode,
      decoder: this.decoder,
      path: options.resetPath ? [] : this.path.concat(encodedOperation),
      resolver: this.resolver,
      settings: this.settings,
      strategy: this.strategy,
      token: this.tokenSource.token,
      visits: options.resetVisits ? new Visits(uri) : this.visits.child(uri),
    });
  }

  getCanonicalUrl(uri: Uri): StrategyResult<ResolverStrategy.CanonicalizeResult> {
    const method = this.strategy.getCanonicalUrl;
    const receiver = this.strategy;
    const operationName = 'Strategy.getCanonicalUrl';
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getResolveRoot(uri: Uri): StrategyResult<ResolverStrategy.ResolveRootResult> {
    const method = this.strategy.getResolveRoot;
    const receiver = this.strategy;
    const operationName = 'Strategy.getResolveRoot';
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getSettings(uri: Uri): StrategyResult<ResolverStrategy.SettingsResult> {
    const method = this.strategy.getSettings;
    const receiver = this.strategy;
    const operationName = 'Strategy.getSettings';
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getUrlForBareModule(
    name: string,
    spec: string,
    path: string
  ): StrategyResult<ResolverStrategy.BareModuleResult> {
    const method = this.strategy.getUrlForBareModule;

    if (!method) {
      return Promise.reject(
        new Error(
          `Unable to resolve bare module spec '${name}@${spec}${path}' because no strategy was found that supports resolving bare modules`
        )
      );
    }

    const receiver = this.strategy;
    const operationName = 'Strategy.getUrlForBareModule';
    const href = `${name}@${spec}${path}`;

    return this.runInChildContext(operationName, href, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, name, spec, path)
    );
  }

  invalidate(uri: Uri) {
    const href = uri.toString();
    const invalidations = this.cacheInvalidations.get(href);
    let invalidated = false;

    if (invalidations) {
      for (const { cacheKey, operationCache } of invalidations) {
        invalidated = operationCache.delete(cacheKey) || invalidated;
      }
    }

    this.cacheInvalidations.deleteAll(href);

    return invalidated;
  }

  listEntries(uri: Uri): StrategyResult<ResolverStrategy.ListEntriesResult> {
    const method = this.strategy.listEntries;
    const receiver = this.strategy;
    const operationName = 'Strategy.listEntries';
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  readFileContent(uri: Uri): StrategyResult<ResolverStrategy.ReadFileContentResult> {
    const method = this.strategy.readFileContent;
    const receiver = this.strategy;
    const operationName = 'Strategy.readFileContent';
    const href = uri.toString();

    this.recordVisit(uri, ResolverContext.VisitKind.File);

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  readParentPackageJson(uri: Uri): StrategyResult<ReadParentPackageJsonResultInternal> {
    return this.runWithCache(
      'readParentPackageJson',
      uri.toString(),
      readParentPackageJson,
      null,
      this,
      uri
    );
  }

  recordVisit(uri: Uri, type: ResolverContext.VisitKind = ResolverContext.VisitKind.File) {
    this.visits.push({ type, uri });
  }

  resolve(spec: string, fromUri: Uri): StrategyResult<ResolveResult> {
    const method = resolveDependency;
    const receiver = null;
    const operationName = 'resolve';
    const href = `${fromUri}|${spec}`;

    return this.runInChildContext(operationName, href, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, fromUri, spec)
    );
  }

  resolveUri(uri: Uri): StrategyResult<ResolveResult> {
    const method = resolve;
    const receiver = null;
    const operationName = 'resolveUri';
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      ctx.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  runInChildContext<T>(
    operationName: string,
    uri: { toString(): string },
    contextFn: (ctx: ResolverContext) => T
  ): T {
    return this.runInContext(
      operationName,
      uri,
      { resetPath: false, resetVisits: false },
      contextFn
    );
  }

  runInIsolatedContext<T>(
    operationName: string,
    uri: { toString(): string },
    contextFn: (ctx: ResolverContext) => T
  ): T {
    return this.runInContext(operationName, uri, { resetPath: true, resetVisits: true }, contextFn);
  }

  private runInContext<T>(
    operationName: string,
    uri: { toString(): string },
    options: { resetPath: boolean; resetVisits: boolean },
    contextFn: (ctx: ResolverContext) => T
  ) {
    const ctx = this.forOperation(operationName, uri, options);

    ctx.debug('%s(%s)', operationName, uri.toString());

    return contextFn(ctx);
  }

  private createStoreResultFn<TMethod extends (...args: any[]) => any>(
    operationCache: Map<string, ReturnTypeWithVisits<TMethod>>,
    cacheKey: string
  ) {
    return (result: ReturnTypeWithVisits<TMethod>) => {
      const mappedResult = this.mapResultWithVisits(result);
      const visited = mappedResult.visited as ResolverContext.Visit[];

      if (mappedResult[CACHE]) {
        const cacheEntries = mappedResult[CACHE] as [string, ReturnTypeWithVisits<TMethod>][];
        delete mappedResult[CACHE];

        for (const [cacheKey, value] of cacheEntries) {
          operationCache.set(cacheKey, value);

          for (const visit of visited) {
            this.cacheInvalidations.add(visit.uri.toString(), { cacheKey, operationCache });
          }
        }
      }

      // Override the pending value with the resolved value
      operationCache.set(cacheKey, mappedResult);

      for (const visit of visited) {
        this.cacheInvalidations.add(visit.uri.toString(), { cacheKey, operationCache });
      }

      return mappedResult;
    };
  }

  private runWithCache<TMethod extends (...args: any[]) => any>(
    cacheSegment: string,
    cacheKey: string,
    fn: TMethod,
    target: unknown,
    ...args: Parameters<TMethod>
  ): ReturnTypeWithVisits<TMethod> {
    let operationCache = this.cache.get(cacheSegment) as
      | Map<string, ReturnTypeWithVisits<TMethod>>
      | undefined;

    if (!operationCache) {
      operationCache = new Map();
      this.cache.set(cacheSegment, operationCache);
    }

    const cached = operationCache.get(cacheKey);

    if (cached) {
      this.debug('%s(%s) [HIT]', cacheSegment, cacheKey);

      // We either have a cached result or a cached promise for a result. Either way, the value
      // is suitable as a return.
      return cached;
    }

    const cacheResult = this.createStoreResultFn(operationCache, cacheKey);

    this.debug('%s(%s) [MISS]', cacheSegment, cacheKey);

    // Nothing is cached
    const ret = fn.apply(target, args);

    if (isThenable(ret)) {
      const promiseRet = ret as Thenable<ReturnTypeWithVisits<TMethod>>;

      // Produce a promise that will only be settled once the cache has been updated accordingly.
      const wrappedRet = promiseRet.then(cacheResult, (err) => {
        // Delete the entry from the cache in case it was a transient failure
        operationCache!.delete(cacheKey);

        return Promise.reject(err);
      });

      // Set the pending value in the cache for now
      operationCache.set(cacheKey, wrappedRet as Awaited<Thenable<ReturnTypeWithVisits<TMethod>>>);

      return wrappedRet as Awaited<Thenable<ReturnTypeWithVisits<TMethod>>>;
    }

    return cacheResult(ret);
  }

  private _wrapError<T extends Error>(
    err: T
  ): T & { path: { operationName: string; uri: Uri | string }[] } {
    return Object.assign(err, {
      path: this.path.map(decodePathNode),
    });
  }

  debug(...args: Parameters<Console['warn']>) {
    if (this.debugMode) {
      if (typeof args[0] === 'string') {
        args[0] = ' '.repeat(this.path.length) + args[0];
      }
      console.warn(...args);
    }
  }
}

function encodePathNode(operationName: string, uri: { toString(): string }) {
  return `${operationName}:${uri.toString()}`;
}

function decodePathNode(node: string) {
  const parts = node.split(':', 2);

  if (parts.length !== 2) {
    console.log('WTF', { node, parts });
    throw new Error(`Invariant violation: Unexpected path node: '${node}'`);
  }

  return {
    operationName: parts[0],
    uri: parts[1].includes(':') ? Uri.parse(parts[1]) : parts[1],
  };
}

async function resolve(ctx: ResolverContext, uri: Uri): Promise<ResolveResult> {
  const bothResolved = all(
    [ctx.getCanonicalUrl(uri), ctx.getResolveRoot(uri), ctx.getSettings(uri)],
    ctx.token
  );

  const [canonicalizationResult, resolveRootResult, settingsResult] = isThenable(bothResolved)
    ? await checkCancellation(bothResolved, ctx.token)
    : bothResolved;

  const rootUri = resolveRootResult.uri;
  const rootUriWithoutTrailingSlash = Uri.ensureTrailingSlash(rootUri, '');

  if (!Uri.isPrefixOf(rootUriWithoutTrailingSlash, canonicalizationResult.uri)) {
    throw new Error(
      `Unable to resolve a module whose path ${canonicalizationResult.uri.toString(
        true
      )} is above the host's root ${rootUri.toString()}`
    );
  }

  const resolveReturn =
    Uri.equals(rootUriWithoutTrailingSlash, canonicalizationResult.uri) ||
    Uri.equals(rootUri, canonicalizationResult.uri)
      ? ctx.runInChildContext('resolveAsDirectory', canonicalizationResult.uri, (ctx) =>
          resolveAsDirectory(
            ctx,
            Uri.ensureTrailingSlash(canonicalizationResult.uri),
            resolveRootResult.uri,
            settingsResult.settings
          )
        )
      : ctx.runInChildContext('resolveAsFile', canonicalizationResult.uri, (ctx) =>
          resolveAsFile(
            ctx,
            canonicalizationResult.uri,
            resolveRootResult.uri,
            settingsResult.settings,
            null
          )
        );
  const readParentPackageJsonReturn = ctx.readParentPackageJson(uri);
  const resolveAndPackageJson = all([resolveReturn, readParentPackageJsonReturn], ctx.token);
  const [resolveResult, readParentPackageJsonResult] = isThenable(resolveAndPackageJson)
    ? await resolveAndPackageJson
    : resolveAndPackageJson;

  return {
    ...resolveResult,
    parentPackageJson: readParentPackageJsonResult.found
      ? {
          packageJson: readParentPackageJsonResult.packageJson,
          uri: readParentPackageJsonResult.uri,
        }
      : undefined,
  };
}

async function resolveDependency(ctx: ResolverContext, fromUri: Uri, spec: string) {
  const parsedSpec = parseBareModuleSpec(spec);

  if (parsedSpec) {
    return ctx.runInChildContext('resolveBareModule', fromUri, (ctx) =>
      resolveBareModule(ctx, fromUri, parsedSpec)
    );
  }

  const relativeUri = Uri.joinPath(
    Uri.from({
      ...fromUri,
      path: dirname(fromUri.path),
    }),
    spec
  );

  return ctx.runInChildContext('resolveUri', relativeUri, (ctx) => resolve(ctx, relativeUri));
}

async function resolveBareModule(ctx: ResolverContext, uri: Uri, parsedSpec: BareModuleSpec) {
  let locatorName = parsedSpec.name;
  let locatorSpec = parsedSpec.spec;
  let locatorPath = parsedSpec.path;

  if (!locatorSpec) {
    const resolveRootReturn = ctx.getResolveRoot(uri);
    const resolveRootResult = isThenable(resolveRootReturn)
      ? await checkCancellation(resolveRootReturn, ctx.token)
      : resolveRootReturn;

    let nextUri = uri;
    const maxIterations = 10;
    const consultedUris: Uri[] = [];

    while (Uri.isPrefixOf(resolveRootResult.uri, nextUri)) {
      if (consultedUris.length >= maxIterations) {
        throw new Error(
          `Consulted a maximum of ${maxIterations} locations while trying to resolve '${bareModuleToSpec(
            parsedSpec
          )}' from '${uri.toString()}', via ${ctx.path.join(' -> ')}: ${consultedUris
            .map((uri) => uri.toString())
            .join(', ')}`
        );
      }

      const currentUri = nextUri;
      consultedUris.push(currentUri);

      const parentPackageJsonReturn = ctx.readParentPackageJson(uri);
      const parentPackageJsonResult = isThenable(parentPackageJsonReturn)
        ? await checkCancellation(parentPackageJsonReturn, ctx.token)
        : parentPackageJsonReturn;

      if (!parentPackageJsonResult.found) {
        throw new DependencyNotFoundError(parsedSpec.nameSpec, uri);
      }
      ctx.recordVisit(parentPackageJsonResult.uri, ResolverContext.VisitKind.File);

      if (parentPackageJsonResult.packageJson.name === parsedSpec.name) {
        // We found a parent directory that *IS* the module we're looking for
        const directoryUri = Uri.ensureTrailingSlash(
          Uri.joinPath(parentPackageJsonResult.uri, '../')
        );
        return ctx.runInChildContext('resolveAsDirectory', directoryUri, (ctx) =>
          resolveAsDirectory(ctx, directoryUri, resolveRootResult.uri, ctx.settings)
        );
      }

      const dependencies = {
        ...(parentPackageJsonResult.packageJson.devDependencies || {}),
        ...(parentPackageJsonResult.packageJson.peerDependencies || {}),
        ...(parentPackageJsonResult.packageJson.dependencies || {}),
      };

      locatorSpec = dependencies[parsedSpec.name];

      if (locatorSpec) {
        break;
      }

      nextUri = Uri.joinPath(parentPackageJsonResult.uri, '..');

      if (Uri.equals(nextUri, currentUri) || Uri.equals(nextUri, resolveRootResult.uri)) {
        break;
      }
    }
  }

  if (!locatorSpec) {
    const builtIn = NODE_CORE_SHIMS[parsedSpec.name];

    if (builtIn) {
      locatorName = builtIn.name;
      locatorSpec = builtIn.spec;
      locatorPath = builtIn.path;
    }
  }

  // If no locator spec was found, it means we were unable
  if (!locatorSpec) {
    throw new DependencyNotFoundError(parsedSpec.nameSpec, uri);
  }

  const bareModuleUriReturn = ctx.getUrlForBareModule(locatorName, locatorSpec, locatorPath);
  const bareModuleUriResult = isThenable(bareModuleUriReturn)
    ? await checkCancellation(bareModuleUriReturn, ctx.token)
    : bareModuleUriReturn;

  if (!bareModuleUriResult.found) {
    throw new DependencyNotFoundError(parsedSpec.nameSpec, uri);
  }

  if (!bareModuleUriResult.uri) {
    // TODO: Inject empty module
    throw new EntryExcludedError(parsedSpec.nameSpec);
  }

  const resolveReturn = ctx.resolveUri(bareModuleUriResult.uri);
  const resolveResult = isThenable(resolveReturn)
    ? await checkCancellation(resolveReturn, ctx.token)
    : resolveReturn;

  return resolveResult;
}
export namespace ResolverContext {
  export interface Options {
    cache: Map<string, Map<string, unknown>>;
    cacheInvalidations: MapSet<string, InvalidationRecord>;
    debug: boolean;
    decoder: Decoder;
    path: string[];
    resolver: Resolver;
    settings: Resolver.Settings;
    strategy: ResolverStrategy;
    token: CancellationToken;
    visits: Visits;
  }

  export enum VisitKind {
    Directory = 'Directory',
    File = 'File',
  }

  export type Visit =
    | {
        type: VisitKind.Directory;
        uri: Uri;
      }
    | {
        type: VisitKind.File;
        uri: Uri;
      };
}

async function resolveAsDirectory(
  ctx: ResolverContext,
  uri: Uri,
  rootUri: Uri,
  settings: Resolver.Settings
): Promise<ResolveResult> {
  ctx.recordVisit(uri, ResolverContext.VisitKind.Directory);

  const listEntriesReturn = ctx.listEntries(uri);
  const listEntriesResult = isThenable(listEntriesReturn)
    ? await checkCancellation(listEntriesReturn, ctx.token)
    : listEntriesReturn;

  let mainPathname = 'index';

  // Step 1: Look for a package.json with an main field
  const packageJsonUri = Uri.joinPath(uri, './package.json');

  ctx.recordVisit(packageJsonUri, ResolverContext.VisitKind.File);

  const packageJsonEntry = listEntriesResult.entries.find(
    (entry) =>
      entry.type === ResolverStrategy.EntryKind.File && Uri.equals(packageJsonUri, entry.uri)
  );

  let packageJson: PartialPackageJson | null = null;

  if (packageJsonEntry) {
    const packageJsonContentReturn = ctx.readFileContent(packageJsonUri);
    const packageJsonContentResult = isThenable(packageJsonContentReturn)
      ? await checkCancellation(packageJsonContentReturn, ctx.token)
      : packageJsonContentReturn;

    packageJson = parseBufferAsPartialPackageJson(
      ctx.decoder,
      packageJsonContentResult.content,
      uri.toString()
    );

    for (const packageMain of settings.packageMain) {
      const pathname = packageJson[packageMain];
      if (typeof pathname === 'string') {
        mainPathname = pathname;
        break;
      }
    }
  }

  const fileUri = Uri.joinPath(uri, mainPathname);

  return ctx.runInChildContext('resolveAsFile', uri, (ctx) =>
    resolveAsFile(ctx, fileUri, rootUri, settings, packageJson)
  );
}

async function resolveAsFile(
  ctx: ResolverContext,
  uri: Uri,
  rootUri: Uri,
  settings: Resolver.Settings,
  packageJson: PartialPackageJson | null,
  ignoreBrowserOverrides = false
): Promise<ResolveResult> {
  if (uri.path === '' || uri.path === '/') {
    throw new TypeError(`Unable to resolve the root as a file: ${uri.toString()}`);
  }

  ctx.recordVisit(uri, ResolverContext.VisitKind.File);

  const browserOverrides = new Map<string, Uri | false>();

  if (packageJson === null) {
    // The parent package.json is only interesting if we are going to look at the `browser`
    // field and then consider browser mapping overrides in there.
    const parentPackageJsonResult =
      settings.packageMain.includes('browser') && !ignoreBrowserOverrides
        ? await checkCancellation(
            ctx.runInChildContext('readParentPackageJsonInternal', uri, (ctx) =>
              readParentPackageJsonInternal(ctx, uri, rootUri, { uriIsCanonicalized: true })
            ),
            ctx.token
          )
        : undefined;
    if (parentPackageJsonResult && parentPackageJsonResult.found) {
      ctx.recordVisit(parentPackageJsonResult.uri, ResolverContext.VisitKind.File);

      packageJson = parentPackageJsonResult.packageJson;

      if (
        parentPackageJsonResult.packageJson.browser &&
        typeof parentPackageJsonResult.packageJson.browser === 'object'
      ) {
        const browserMap = parentPackageJsonResult.packageJson.browser;
        const packageJsonDir = Uri.joinPath(parentPackageJsonResult.uri, '..');

        for (const entry in browserMap) {
          const impliedUri = Uri.joinPath(packageJsonDir, entry);
          const targetSpec = browserMap[entry];
          const target = targetSpec === false ? false : Uri.joinPath(packageJsonDir, targetSpec);

          if (Uri.equals(impliedUri, uri)) {
            if (target === false) {
              return {
                found: false,
                uri: null,
              };
            }

            // console.warn('REMAPPED %s to %s', url, target);

            // We found an exact match so let's make sure we resolve the re-mapped file but
            // also that we don't go through the browser overrides rodeo again.
            return ctx.runInChildContext('resolveAsFile', target, (ctx) =>
              resolveAsFile(ctx, target, rootUri, settings, packageJson, true)
            );
          }

          browserOverrides.set(impliedUri.toString(), target);
        }
      }
    }
  }

  const containingDirUri = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));

  const filename = basename(uri.path);
  const entriesReturn = ctx.listEntries(containingDirUri);
  const entriesResult = isThenable(entriesReturn)
    ? await checkCancellation(entriesReturn, ctx.token)
    : entriesReturn;
  const entryDirectoryMap = new Map<string, ResolverStrategy.Entry>();
  const entryFileMap = new Map<string, ResolverStrategy.Entry<ResolverStrategy.EntryKind.File>>();

  for (const entry of entriesResult.entries) {
    if (Uri.equals(entry.uri, uri) && entry.type == ResolverStrategy.EntryKind.File) {
      // Found an exact match
      return {
        found: true,
        rootUri,
        uri,
      };
    }

    if (entry.type === ResolverStrategy.EntryKind.Directory) {
      const childFilename = Uri.getFirstPathSegmentAfterPrefix(entry.uri, containingDirUri);

      entryDirectoryMap.set(childFilename, entry);
    } else if (entry.type === ResolverStrategy.EntryKind.File) {
      const childFilename = basename(entry.uri.path);

      entryFileMap.set(
        childFilename,
        entry as ResolverStrategy.Entry<ResolverStrategy.EntryKind.File>
      );
    }
  }

  // Look for browser overrides
  for (const ext of settings.extensions) {
    const hrefWithExtensionUri = uri.with({ path: `${uri.path}${ext}` });
    const hrefWithExtension = hrefWithExtensionUri.toString();
    const mapping = browserOverrides.get(hrefWithExtension);

    ctx.recordVisit(hrefWithExtensionUri, ResolverContext.VisitKind.File);

    if (mapping === false) {
      // console.warn('REMAPPED %s to undefined', url);
      return {
        found: true,
        rootUri,
        uri: null,
      };
    } else if (mapping) {
      // console.warn('REMAPPED %s to %s', url, mapping);

      return ctx.runInChildContext('resolveAsFile', mapping, (ctx) =>
        resolveAsFile(ctx, mapping, rootUri, settings, packageJson, true)
      );
    }

    const match = entryFileMap.get(`${filename}${ext}`);
    if (match) {
      if (match.type !== ResolverStrategy.EntryKind.File) {
        continue;
      }

      return {
        found: true,
        rootUri,
        uri: match.uri,
      };
    }
  }

  // First, attempt to find a matching file or directory
  const match = entryDirectoryMap.get(filename);
  if (match) {
    if (match.type !== ResolverStrategy.EntryKind.Directory) {
      throw new Error(`Invariant violation ${match.type} is unexpected`);
    }

    return ctx.runInChildContext('resolveAsDirectory', match.uri, (ctx) =>
      resolveAsDirectory(ctx, Uri.ensureTrailingSlash(match.uri), rootUri, settings)
    );
  }

  throw new EntryNotFoundError(uri);
}

async function readParentPackageJson(ctx: ResolverContext, uri: Uri) {
  const canonicalizationReturn = ctx.getCanonicalUrl(uri);
  const resolveRootReturn = ctx.getResolveRoot(uri);
  const bothResolved = all([canonicalizationReturn, resolveRootReturn], ctx.token);
  const [canonicalizationResult, resolveRootResult] = isThenable(bothResolved)
    ? await checkCancellation(bothResolved, ctx.token)
    : bothResolved;
  const readReturn = ctx.runInChildContext(
    'readParentPackageJsonInternal',
    canonicalizationResult.uri,
    (ctx) =>
      readParentPackageJsonInternal(ctx, canonicalizationResult.uri, resolveRootResult.uri, {
        uriIsCanonicalized: true,
      })
  );
  const readResult = isThenable(readReturn) ? await readReturn : readReturn;

  if (readResult.found && readResult.visitedDirs) {
    const visitedDirs = readResult.visitedDirs;
    delete readResult.visitedDirs;

    (readResult as any)[CACHE] = visitedDirs.map((uri) => [uri.toString(), { ...readResult, uri }]);
  }

  return readResult as ReadParentPackageJsonResultInternal;
}

async function readParentPackageJsonInternal(
  ctx: ResolverContext,
  uri: Uri,
  rootUri: Uri,
  options: { uriIsCanonicalized: boolean }
): Promise<ReadParentPackageJsonResultInternal> {
  if (!options.uriIsCanonicalized) {
    const canonicalizationReturn = ctx.getCanonicalUrl(uri);
    const canonicalizationResult = isThenable(canonicalizationReturn)
      ? await checkCancellation(canonicalizationReturn, ctx.token)
      : canonicalizationReturn;

    uri = canonicalizationResult.uri;
  }

  const hostRootHref = Uri.ensureTrailingSlash(rootUri);
  const containingDirUrl = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));
  const visitedDirs = [] as Uri[];

  const readPackageJsonOrRecurse = async (
    ctx: ResolverContext,
    dir: Uri
  ): Promise<ReadParentPackageJsonResultInternal> => {
    if (!Uri.isPrefixOf(hostRootHref, dir)) {
      // Terminal condition for recursion
      return {
        found: false,
        packageJson: null,
        uri: null,
      };
    }

    ctx.recordVisit(dir, ResolverContext.VisitKind.Directory);

    const entriesReturn = ctx.listEntries(dir);
    const entriesResult = isThenable(entriesReturn)
      ? await checkCancellation(entriesReturn, ctx.token)
      : entriesReturn;
    const packageJsonUri = Uri.joinPath(dir, 'package.json');
    const packageJsonEntry = entriesResult.entries.find(
      (entry) =>
        entry.type === ResolverStrategy.EntryKind.File && Uri.equals(entry.uri, packageJsonUri)
    );

    ctx.recordVisit(packageJsonUri, ResolverContext.VisitKind.File);

    if (packageJsonEntry) {
      // Found! Let's try to parse
      try {
        const parentPackageJsonContentReturn = ctx.readFileContent(packageJsonUri);
        const parentPackageJsonContentResult = isThenable(parentPackageJsonContentReturn)
          ? await checkCancellation(parentPackageJsonContentReturn, ctx.token)
          : parentPackageJsonContentReturn;

        const packageJson = parseBufferAsPackageJson(
          ctx.decoder,
          parentPackageJsonContentResult.content,
          packageJsonUri.toString()
        );

        return { found: true, packageJson, uri: packageJsonUri, visitedDirs };
      } catch (err) {
        if (err instanceof CanceledError || (err && err.name === 'CanceledError')) {
          throw err;
        }

        // TODO: Maybe issue some warning?
      }
    }

    // Not found here, let's try one up
    const parentDir = Uri.ensureTrailingSlash(Uri.joinPath(dir, '..'));

    // Skip infinite recursion
    if (Uri.equals(dir, parentDir) || Uri.isPrefixOf(dir, parentDir)) {
      return {
        found: false,
        packageJson: null,
        uri: null,
      };
    }

    visitedDirs.push(dir);

    return ctx.runInChildContext('readPackageJsonOrRecurse', parentDir, (ctx) =>
      readPackageJsonOrRecurse(ctx, parentDir)
    );
  };

  if (Uri.equals(uri, containingDirUrl) || Uri.isPrefixOf(uri, containingDirUrl)) {
    return {
      found: false,
      packageJson: null,
      uri: null,
    };
  }
  return ctx.runInChildContext('readPackageJsonOrRecurse', containingDirUrl, (ctx) =>
    readPackageJsonOrRecurse(ctx, containingDirUrl)
  );
}

function bareModuleToSpec(bareModule: BareModuleSpec) {
  return `${bareModule.nameSpec}${bareModule.path}`;
}
