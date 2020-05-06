import { basename, CancellationToken, CancellationTokenSource, Thenable } from 'ts-primitives';
import { all, Awaited, checkCancellation, isThenable } from './async';
import { Decoder } from './decoder';
import { CanceledError, EntryNotFoundError } from './error';
import { PackageJson, parseBufferAsPackageJson } from './packageJson';
import { Resolver } from './resolver';
import { Settings } from './settings';
import { ResolvedEntry, ResolvedEntryKind, ResolverStrategy } from './strategy';
import { Uri } from './uri';

type ReturnTypeWithVisits<
  T extends (...args: any[]) => any,
  TReturn = ReturnType<T>
> = TReturn extends Thenable<infer U>
  ? Thenable<U & { visited: Visit[] }>
  : TReturn & { visited: Visit[] };

// type UncachedReturnType<T> = { [K in keyof T] : K extends typeof CACHE ? never : T[K] };
// type UncachedReturn<
//   T extends (...any: any[]) => any,
//   TReturn = ReturnType<T>
// > = TReturn extends Thenable<infer U>
//   ? Thenable<UncachedReturnType<U>>
//   : UncachedReturnType<TReturn>;

const DEBUG = process.env.NODE_DEBUG?.match(/\bbuilder\b/);
const CACHE = Symbol('Context.cache');

type ResolveResult =
  | {
      found: false;
      uri: null;
    }
  | { found: true; uri: null; rootUri: Uri }
  | { found: true; uri: Uri; rootUri: Uri };

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

interface ReadParentPackageJsonResultInternalFound {
  found: true;
  packageJson: PackageJson;
  uri: Uri;
  visitedDirs: Uri[];
}

interface ReadParentPackageJsonResultInternalNotFound {
  found: false;
  packageJson: null;
  uri: null;
}

type ReadParentPackageJsonResultInternal =
  | ReadParentPackageJsonResultInternalFound
  | ReadParentPackageJsonResultInternalNotFound;

class Visits {
  #parent?: Visits;
  #visits = [] as Visit[];

  constructor(readonly uri: { toString(): string }, parent?: Visits) {
    this.#parent = parent;
  }

  child(uri: { toString(): string }): Visits {
    return new Visits(uri, this);
  }

  push(visit: Visit) {
    // if (!this.#parent) console.debug('[VISIT] %s -> %s [%s]', this.uri, visit.uri, visit.type);
    if (!this.#visits.find((cmp) => cmp.type == visit.type && Uri.equals(cmp.uri, visit.uri))) {
      this.#visits.push(visit);
      this.#parent?.push(visit);
    }
  }

  toArray(): Visit[] {
    return this.#parent ? this.#parent.toArray() : this.#visits.slice();
  }
}

interface ResolverContextOptions {
  cache: Map<string, Map<string, unknown>>;
  decoder: Decoder;
  path: string[];
  resolver: Resolver;
  settings: Settings;
  strategy: ResolverStrategy;
  token: CancellationToken;
  visits: Visits;
}

export class ResolverContext {
  static create(
    resolver: Resolver,
    strategy: ResolverStrategy,
    settings: Settings,
    token: CancellationToken
  ) {
    return new ResolverContext({
      cache: new Map(),
      decoder: new Decoder(),
      path: [],
      resolver,
      settings,
      strategy,
      token,
      visits: new Visits(Uri.parse('velcro:///root')),
    });
  }

  readonly #cache: ResolverContextOptions['cache'];
  readonly #decoder: ResolverContextOptions['decoder'];
  readonly #mapResultWithVisits = <T>(result: T) =>
    Object.assign(result, { visited: this.#visits.toArray() });
  readonly #path: ResolverContextOptions['path'];
  readonly #resolver: ResolverContextOptions['resolver'];
  readonly #settings: ResolverContextOptions['settings'];
  readonly #strategy: ResolverContextOptions['strategy'];
  readonly #tokenSource: CancellationTokenSource;
  readonly #visits: Visits;

  private constructor(options: ResolverContextOptions) {
    this.#cache = options.cache;
    this.#decoder = options.decoder;
    this.#path = options.path;
    this.#resolver = options.resolver;
    this.#settings = options.settings;
    this.#strategy = options.strategy;
    this.#tokenSource = new CancellationTokenSource(options.token);
    this.#visits = options.visits;
  }

  get decoder() {
    return this.#decoder;
  }

  get path() {
    return this.#path.slice() as ReadonlyArray<string>;
  }

  get settings() {
    return this.#settings as Readonly<Settings>;
  }

  get token() {
    return this.#tokenSource.token;
  }

  get visited() {
    return this.#visits.toArray();
  }

  canResolve(uri: Uri) {
    const method = this.#strategy.canResolve;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  dispose() {
    this.#tokenSource.dispose(true);
  }

  getCanonicalUrl(uri: Uri) {
    const method = this.#strategy.getCanonicalUrl;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getResolveRoot(uri: Uri) {
    const method = this.#strategy.getResolveRoot;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getSettings(uri: Uri) {
    const method = this.#strategy.getSettings;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  getUrlForBareModule(name: string, spec: string, path: string) {
    const method = this.#strategy.getUrlForBareModule;

    if (!method) {
      return Promise.reject(
        new Error(
          `Unable to resolve bare module spec '${name}@${spec}${path}' because no strategy was found that supports resolving bare modules`
        )
      );
    }

    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = `${name}@${spec}${path}`;

    return this.runInChildContext(operationName, href, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, name, spec, path)
    );
  }

  listEntries(uri: Uri) {
    const method = this.#strategy.listEntries;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  readFileContent(uri: Uri) {
    const method = this.#strategy.readFileContent;
    const receiver = this.#strategy;
    const operationName = `${this.#strategy.constructor.name}.${method.name}`;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
    );
  }

  readParentPackageJson(uri: Uri) {
    return this.runWithCache(
      'readParentPackageJson',
      uri.toString(),
      readParentPackageJson,
      null,
      this,
      uri
    );
  }

  recordVisit(uri: Uri, type: VisitKind = VisitKind.File) {
    this.#visits.push({ type, uri });
  }

  resolve(uri: Uri) {
    const method = resolve;
    const receiver = null;
    const operationName = method.name;
    const href = uri.toString();

    return this.runInChildContext(operationName, uri, (ctx) =>
      this.runWithCache(operationName, href, method, receiver, ctx, uri)
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
    const encodedOperation = encodePathNode(operationName, uri);

    if (this.#path.includes(encodedOperation)) {
      const formattedPath = this.#path
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

    const ctx = new ResolverContext({
      cache: this.#cache,
      decoder: this.#decoder,
      path: options.resetPath ? [] : this.#path.concat(encodedOperation),
      resolver: this.#resolver,
      settings: this.#settings,
      strategy: this.#strategy,
      token: this.#tokenSource.token,
      visits: options.resetVisits ? new Visits(uri) : this.#visits.child(uri),
    });

    ctx.debug('%s(%s)', operationName, uri);

    return contextFn(ctx);
  }

  private runWithCache<TMethod extends (...args: any[]) => any>(
    cacheSegment: string,
    cacheKey: string,
    fn: TMethod,
    target: unknown,
    ...args: Parameters<TMethod>
  ): ReturnTypeWithVisits<TMethod> {
    let operationCache = this.#cache.get(cacheSegment) as
      | Map<string, ReturnTypeWithVisits<TMethod>>
      | undefined;

    if (!operationCache) {
      operationCache = new Map();
      this.#cache.set(cacheSegment, operationCache);
    }

    const cached = operationCache.get(cacheKey);

    if (cached) {
      this.debug('%s(%s) [HIT]', cacheSegment, cacheKey);

      // We either have a cached result or a cached promise for a result. Either way, the value
      // is suitable as a return.
      return cached;
    }

    this.debug('%s(%s) [MISS]', cacheSegment, cacheKey);

    // Nothing is cached
    const ret = fn.apply(target, args);

    if (isThenable(ret)) {
      const promiseRet = ret as Thenable<ReturnTypeWithVisits<TMethod>>;

      // Produce a promise that will only be settled once the cache has been updated accordingly.
      const wrappedRet = promiseRet.then(
        (result) => {
          const mappedResult = this.#mapResultWithVisits(result);

          if (mappedResult[CACHE]) {
            const cacheEntries = mappedResult[CACHE] as [string, ReturnTypeWithVisits<TMethod>][];
            delete mappedResult[CACHE];

            for (const [cacheKey, value] of cacheEntries) {
              operationCache!.set(cacheKey, value);
            }
          }

          // Override the pending value with the resolved value
          operationCache!.set(cacheKey, mappedResult);

          return mappedResult;
        },
        (err) => {
          // Delete the entry from the cache in case it was a transient failure
          operationCache!.delete(cacheKey);

          return Promise.reject(err);
        }
      );

      // Set the pending value in the cache for now
      operationCache.set(cacheKey, wrappedRet as Awaited<Thenable<ReturnTypeWithVisits<TMethod>>>);

      return wrappedRet as Awaited<Thenable<ReturnTypeWithVisits<TMethod>>>;
    }

    const mappedResult = this.#mapResultWithVisits(ret);

    if (mappedResult[CACHE]) {
      const cacheEntries = mappedResult[CACHE] as [string, ReturnTypeWithVisits<TMethod>][];
      delete mappedResult[CACHE];

      for (const [cacheKey, value] of cacheEntries) {
        operationCache!.set(cacheKey, value);
      }
    }

    operationCache.set(cacheKey, mappedResult);

    return mappedResult;
  }

  private _wrapError<T extends Error>(
    err: T
  ): T & { path: { operationName: string; uri: Uri | string }[] } {
    return Object.assign(err, {
      path: this.#path.map(decodePathNode),
    });
  }

  debug(...args: Parameters<Console['debug']>) {
    if (DEBUG) {
      if (typeof args[0] === 'string') {
        args[0] = ' '.repeat(this.#path.length) + args[0];
      }
      console.debug(...args);
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

async function resolve(ctx: ResolverContext, url: Uri | string): Promise<ResolveResult> {
  const uri = Uri.isUri(url) ? url : Uri.parse(url);
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

  if (
    Uri.equals(rootUriWithoutTrailingSlash, canonicalizationResult.uri) ||
    Uri.equals(rootUri, canonicalizationResult.uri)
  ) {
    return ctx.runInChildContext('resolveAsDirectory', canonicalizationResult.uri, (ctx) =>
      resolveAsDirectory(
        ctx,
        canonicalizationResult.uri,
        resolveRootResult.uri,
        settingsResult.settings
      )
    );
  }

  return ctx.runInChildContext('resolveAsFile', canonicalizationResult.uri, (ctx) =>
    resolveAsFile(
      ctx,
      canonicalizationResult.uri,
      resolveRootResult.uri,
      settingsResult.settings,
      null
    )
  );
}

async function resolveAsDirectory(
  ctx: ResolverContext,
  uri: Uri,
  rootUri: Uri,
  settings: Settings
): Promise<ResolveResult> {
  ctx.recordVisit(uri, VisitKind.Directory);

  const listEntriesReturn = ctx.listEntries(uri);
  const listEntriesResult = isThenable(listEntriesReturn)
    ? await checkCancellation(listEntriesReturn, ctx.token)
    : listEntriesReturn;

  let mainPathname = 'index';

  // Step 1: Look for a package.json with an main field
  const packageJsonUri = Uri.joinPath(uri, './package.json');

  ctx.recordVisit(packageJsonUri, VisitKind.File);

  const packageJsonEntry = listEntriesResult.entries.find(
    (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(packageJsonUri, entry.uri)
  );

  let packageJson: PackageJson | null = null;

  if (packageJsonEntry) {
    const packageJsonContentReturn = ctx.readFileContent(packageJsonUri);
    const packageJsonContentResult = isThenable(packageJsonContentReturn)
      ? await checkCancellation(packageJsonContentReturn, ctx.token)
      : packageJsonContentReturn;

    packageJson = parseBufferAsPackageJson(
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
  settings: Settings,
  packageJson: PackageJson | null,
  ignoreBrowserOverrides = false
): Promise<ResolveResult> {
  if (uri.path === '' || uri.path === '/') {
    throw new TypeError(`Unable to resolve the root as a file: ${uri.toString()}`);
  }

  ctx.recordVisit(uri, VisitKind.File);

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
      ctx.recordVisit(parentPackageJsonResult.uri, VisitKind.File);

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
  const entryDirectoryMap = new Map<string, ResolvedEntry>();
  const entryFileMap = new Map<string, ResolvedEntry<ResolvedEntryKind.File>>();

  for (const entry of entriesResult.entries) {
    if (Uri.equals(entry.uri, uri) && entry.type == ResolvedEntryKind.File) {
      // Found an exact match
      return {
        found: true,
        rootUri,
        uri,
      };
    }

    if (entry.type === ResolvedEntryKind.Directory) {
      const childFilename = Uri.getFirstPathSegmentAfterPrefix(entry.uri, containingDirUri);

      entryDirectoryMap.set(childFilename, entry);
    } else if (entry.type === ResolvedEntryKind.File) {
      const childFilename = basename(entry.uri.path);

      entryFileMap.set(childFilename, entry as ResolvedEntry<ResolvedEntryKind.File>);
    }
  }

  // Look for browser overrides
  for (const ext of settings.extensions) {
    const hrefWithExtensionUri = uri.with({ path: `${uri.path}${ext}` });
    const hrefWithExtension = hrefWithExtensionUri.toString();
    const mapping = browserOverrides.get(hrefWithExtension);

    ctx.recordVisit(hrefWithExtensionUri, VisitKind.File);

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
      if (match.type !== ResolvedEntryKind.File) {
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
    if (match.type !== ResolvedEntryKind.Directory) {
      throw new Error(`Invariant violation ${match.type} is unexpected`);
    }

    return ctx.runInChildContext('resolveAsDirectory', match.uri, (ctx) =>
      resolveAsDirectory(ctx, match.uri, rootUri, settings)
    );
  }

  throw new EntryNotFoundError(uri);
}

async function readParentPackageJson(ctx: ResolverContext, url: string | Uri) {
  const uri = Uri.isUri(url) ? url : Uri.parse(url);
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

  return readResult;
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

    ctx.recordVisit(dir, VisitKind.Directory);

    const entriesReturn = ctx.listEntries(dir);
    const entriesResult = isThenable(entriesReturn)
      ? await checkCancellation(entriesReturn, ctx.token)
      : entriesReturn;
    const packageJsonUri = Uri.joinPath(dir, 'package.json');
    const packageJsonEntry = entriesResult.entries.find(
      (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(entry.uri, packageJsonUri)
    );

    ctx.recordVisit(packageJsonUri, VisitKind.File);

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
    if (Uri.equals(uri, parentDir)) {
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

  return ctx.runInChildContext('readPackageJsonOrRecurse', containingDirUrl, (ctx) =>
    readPackageJsonOrRecurse(ctx, containingDirUrl)
  );
}
