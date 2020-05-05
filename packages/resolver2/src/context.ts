import { CancellationToken, Thenable, CancellationTokenSource, basename } from 'ts-primitives';

import { isThenable, Awaited, all, checkCancellation } from './async';
import { Decoder } from './decoder';
import { EntryNotFoundError, CanceledError } from './error';
import { PackageJson, parseBufferAsPackageJson } from './packageJson';
import { Resolver } from './resolver';
import { Settings } from './settings';
import { ResolverStrategy, ResolvedEntryKind, ResolvedEntry } from './strategy';
import { Uri } from './uri';

const DEBUG = process.env.DEBUG?.match(/\bbuilder\b/);

// type HeadArgs<T extends (...args: any[]) => any> = T extends (head: infer I, ...tail: any[]) => any
//   ? I
//   : never;
// type TailArgs<T extends (...args: any[]) => any> = T extends (head: any, ...tail: infer I) => any
//   ? I
//   : never;

type ResolveResult =
  | {
      found: false;
      uri: null;
    }
  | { found: true; uri: null; rootUri: Uri }
  | { found: true; uri: Uri; rootUri: Uri };

interface ReadParentPackageJsonResultInternalFound {
  found: true;
  packageJson: PackageJson;
  uri: Uri;
}

interface ReadParentPackageJsonResultInternalNotFound {
  found: false;
  packageJson: null;
  uri: null;
}

type ReadParentPackageJsonResultInternal =
  | ReadParentPackageJsonResultInternalFound
  | ReadParentPackageJsonResultInternalNotFound;

interface ResolverContextOptions {
  cache: Map<string, Map<string, unknown>>;
  decoder: Decoder;
  path: string[];
  resolver: Resolver;
  settings: Settings;
  strategy: ResolverStrategy;
  token: CancellationToken;
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
    });
  }

  readonly #cache: ResolverContextOptions['cache'];
  readonly #decoder: ResolverContextOptions['decoder'];
  readonly #path: ResolverContextOptions['path'];
  readonly #resolver: ResolverContextOptions['resolver'];
  readonly #settings: ResolverContextOptions['settings'];
  readonly #strategy: ResolverContextOptions['strategy'];
  readonly #tokenSource: CancellationTokenSource;

  private constructor(options: ResolverContextOptions) {
    this.#cache = options.cache;
    this.#decoder = options.decoder;
    this.#path = options.path;
    this.#resolver = options.resolver;
    this.#settings = options.settings;
    this.#strategy = options.strategy;
    this.#tokenSource = new CancellationTokenSource(options.token);
  }

  get decoder() {
    return this.#decoder;
  }

  get settings() {
    return this.#settings as Readonly<Settings>;
  }

  get token() {
    return this.#tokenSource.token;
  }

  canResolve(uri: Uri) {
    return this.#strategy.canResolve(uri);
  }

  dispose() {
    this.#tokenSource.dispose(true);
  }

  getCanonicalUrl(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getCanonicalUrl, uri);
  }

  getResolveRoot(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getResolveRoot, uri);
  }

  getSettings(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getSettings, uri);
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

    return this._invokeStrategyMethod(method, name, spec, path);
  }

  listEntries(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.listEntries, uri);
  }

  readFileContent(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.readFileContent, uri);
  }

  readParentPackageJson(uri: Uri) {
    return this._invokeOwnMethod(this._readParentPackageJson, uri);
  }

  resolve(uri: Uri) {
    return this._invokeOwnMethod(this._resolve, uri);
  }

  // run<TFunction extends (target: { toString(): string }, ...args: any[]) => any>(
  //   fn: TFunction,
  //   target: HeadArgs<TFunction>,
  //   receiver: { constructor: { name: string } },
  //   ...args: TailArgs<TFunction>
  // ): ReturnType<TFunction> {
  //   const operationName = `${receiver.constructor.name}.${fn.name}`;
  //   const ctx = this.withOperation(operationName, target);
  // }

  private async _readParentPackageJson(
    url: string | Uri
  ): Promise<ReadParentPackageJsonResultInternal> {
    this.debug('ctx._readParentPackageJson(%s)', url);
    const uri = Uri.isUri(url) ? url : Uri.parse(url);
    const canonicalizationReturn = this.getCanonicalUrl(uri);
    const resolveRootReturn = this.getResolveRoot(uri);
    const bothResolved = all([canonicalizationReturn, resolveRootReturn], this.token);
    const [canonicalizationResult, resolveRootResult] = isThenable(bothResolved)
      ? await checkCancellation(bothResolved, this.token)
      : bothResolved;

    return this._readParentPackageJsonInternal(canonicalizationResult.uri, resolveRootResult.uri, {
      uriIsCanonicalized: true,
    });
  }

  private async _resolve(url: Uri | string): Promise<ResolveResult> {
    this.debug('ctx._resolve(%s)', url);
    const uri = Uri.isUri(url) ? url : Uri.parse(url);
    const bothResolved = all(
      [this.getCanonicalUrl(uri), this.getResolveRoot(uri), this.getSettings(uri)],
      this.token
    );

    const [canonicalizationResult, resolveRootResult, settingsResult] = isThenable(bothResolved)
      ? await checkCancellation(bothResolved, this.token)
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
      return this._resolveAsDirectory(
        canonicalizationResult.uri,
        resolveRootResult.uri,
        settingsResult.settings
      );
    }

    return this._resolveAsFile(
      canonicalizationResult.uri,
      resolveRootResult.uri,
      settingsResult.settings,
      null
    );
  }

  private async _resolveAsDirectory(
    uri: Uri,
    rootUri: Uri,
    settings: Settings
  ): Promise<ResolveResult> {
    this.debug('ctx._resolveAsDirectory(%s)', uri);
    // TODO: Visited
    // ctx.visited.add(rootUri.toString());

    const listEntriesReturn = this.listEntries(uri);
    const listEntriesResult = isThenable(listEntriesReturn)
      ? await checkCancellation(listEntriesReturn, this.token)
      : listEntriesReturn;

    let mainPathname = 'index';

    // Step 1: Look for a package.json with an main field
    const packageJsonUri = Uri.joinPath(uri, './package.json');

    // TODO: Visited
    // this.visited.add(packageJsonUri.toString());

    const packageJsonEntry = listEntriesResult.entries.find(
      (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(packageJsonUri, entry.uri)
    );

    let packageJson: PackageJson | null = null;

    if (packageJsonEntry) {
      const packageJsonContentReturn = this.readFileContent(packageJsonUri);
      const packageJsonContentResult = isThenable(packageJsonContentReturn)
        ? await checkCancellation(packageJsonContentReturn, this.token)
        : packageJsonContentReturn;

      packageJson = parseBufferAsPackageJson(
        this.decoder,
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

    return this._resolveAsFile(Uri.joinPath(uri, mainPathname), rootUri, settings, packageJson);
  }

  private async _resolveAsFile(
    uri: Uri,
    rootUri: Uri,
    settings: Settings,
    packageJson: PackageJson | null,
    ignoreBrowserOverrides = false
  ): Promise<ResolveResult> {
    this.debug('ctx._resolveAsFile(%s)', uri);
    if (uri.path === '' || uri.path === '/') {
      throw new TypeError(`Unable to resolve the root as a file: ${uri.toString()}`);
    }

    // TODO: Visited
    // this.visited.add(uri.toString());

    const browserOverrides = new Map<string, Uri | false>();

    if (packageJson === null) {
      // The parent package.json is only interesting if we are going to look at the `browser`
      // field and then consider browser mapping overrides in there.
      const parentPackageJsonResult =
        settings.packageMain.includes('browser') && !ignoreBrowserOverrides
          ? await checkCancellation(
              this._readParentPackageJsonInternal(uri, rootUri, {
                uriIsCanonicalized: true,
              }),
              this.token
            )
          : undefined;
      if (parentPackageJsonResult && parentPackageJsonResult.found) {
        // TODO: Visited
        // this.visited.add(parentPackageJsonResult.uri.toString());

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
              return this._resolveAsFile(target, rootUri, settings, packageJson, true);
            }

            browserOverrides.set(impliedUri.toString(), target);
          }
        }
      }
    }

    const containingDirUri = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));

    // TODO: Visited
    // this.visited.add(containingDirUri.toString());

    const filename = basename(uri.path);
    const entriesReturn = this.listEntries(containingDirUri);
    const entriesResult = isThenable(entriesReturn)
      ? await checkCancellation(entriesReturn, this.token)
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
      const hrefWithExtension = uri.with({ path: `${uri.path}${ext}` }).toString();
      const mapping = browserOverrides.get(hrefWithExtension);

      // TODO: Visted
      // this.visited.add(hrefWithExtension);

      if (mapping === false) {
        // console.warn('REMAPPED %s to undefined', url);
        return {
          found: true,
          rootUri,
          uri: null,
        };
      } else if (mapping) {
        // console.warn('REMAPPED %s to %s', url, mapping);

        return this._resolveAsFile(mapping, rootUri, settings, packageJson, true);
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

      return this._resolveAsDirectory(match.uri, rootUri, settings);
    }

    throw new EntryNotFoundError(uri);
  }

  private async _readParentPackageJsonInternal(
    uri: Uri,
    rootUri: Uri,
    options: { uriIsCanonicalized: boolean }
  ): Promise<ReadParentPackageJsonResultInternal> {
    this.debug('ctx._readParentPackageJsonInternal(%s)', uri);
    if (!options.uriIsCanonicalized) {
      const canonicalizationReturn = this.getCanonicalUrl(uri);
      const canonicalizationResult = isThenable(canonicalizationReturn)
        ? await checkCancellation(canonicalizationReturn, this.token)
        : canonicalizationReturn;

      uri = canonicalizationResult.uri;
    }

    const hostRootHref = Uri.ensureTrailingSlash(rootUri);
    const containingDirUrl = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));

    const readPackageJsonOrRecurse = async (
      dir: Uri
    ): Promise<ReadParentPackageJsonResultInternal> => {
      this.debug('ctx._readParentPackageJsonInternal::readPackageJsonOrRecurse(%s, %s)', uri, dir);
      if (!Uri.isPrefixOf(hostRootHref, dir)) {
        // Terminal condition for recursion
        return {
          found: false,
          packageJson: null,
          uri: null,
        };
      }

      // TODO: Visited
      // this.visited.add(dir.toString());

      const entriesReturn = this.listEntries(dir);
      const entriesResult = isThenable(entriesReturn)
        ? await checkCancellation(entriesReturn, this.token)
        : entriesReturn;
      const packageJsonUri = Uri.joinPath(dir, 'package.json');
      const packageJsonEntry = entriesResult.entries.find(
        (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(entry.uri, packageJsonUri)
      );

      // TODO: Visited
      // this.visited.add(packageJsonUri.toString());

      if (packageJsonEntry) {
        // Found! Let's try to parse
        try {
          const parentPackageJsonContentReturn = this.readFileContent(packageJsonUri);
          const parentPackageJsonContentResult = isThenable(parentPackageJsonContentReturn)
            ? await checkCancellation(parentPackageJsonContentReturn, this.token)
            : parentPackageJsonContentReturn;

          const packageJson = parseBufferAsPackageJson(
            this.decoder,
            parentPackageJsonContentResult.content,
            packageJsonUri.toString()
          );

          return { found: true, packageJson, uri: packageJsonUri };
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

      return readPackageJsonOrRecurse(parentDir);
    };

    return readPackageJsonOrRecurse(containingDirUrl);
  }

  withOperation(operationName: string, uri: { toString(): string }) {
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
      path: this.#path.concat(encodedOperation),
      resolver: this.#resolver,
      settings: this.#settings,
      strategy: this.#strategy,
      token: this.#tokenSource.token,
    });

    ctx.debug('%s(%s)', operationName, uri);

    return ctx;
  }

  private _invokeOwnMethod<
    TMethod extends
      | typeof ResolverContext.prototype._readParentPackageJson
      | typeof ResolverContext.prototype._resolve
  >(method: TMethod, uri: Uri): ReturnType<TMethod> {
    const operationName = `ctx.${method.name}`;
    const uriStr = uri.toString();
    let operationCache = this.#cache.get(operationName) as
      | Map<string, ReturnType<TMethod>>
      | undefined;

    if (!operationCache) {
      operationCache = new Map();
      this.#cache.set(operationName, operationCache);
    }

    const cached = operationCache.get(uriStr);

    if (cached) {
      this.debug('%s(%s) [HIT]', operationName, uriStr);

      // We either have a cached result or a cached promise for a result. Either way, the value
      // is suitable as a return.
      return cached;
    }

    this.debug('%s(%s) [MISS]', operationName, uriStr);

    // Nothing is cached
    const ret = (method as any).call(this, uri, {
      ctx: this.withOperation(operationName, uri),
    }) as ReturnType<TMethod>;

    if (isThenable(ret)) {
      const promiseRet = ret as Thenable<ReturnType<TMethod>>;

      // Produce a promise that will only be settled once the cache has been updated accordingly.
      const wrappedRet = promiseRet.then(
        (result) => {
          // Override the pending value with the resolved value
          operationCache!.set(uriStr, result);

          return result;
        },
        (err) => {
          // Delete the entry from the cache in case it was a transient failure
          operationCache!.delete(uriStr);

          return Promise.reject(err);
        }
      );

      // Set the pending value in the cache for now
      operationCache.set(uriStr, wrappedRet as Awaited<Thenable<ReturnType<TMethod>>>);

      return wrappedRet as Awaited<Thenable<ReturnType<TMethod>>>;
    }

    operationCache.set(uriStr, ret);

    return ret;
  }

  private _invokeStrategyMethod<
    TMethod extends Required<ResolverStrategy>[
      | 'getCanonicalUrl'
      | 'getResolveRoot'
      | 'getSettings'
      | 'getUrlForBareModule'
      | 'listEntries'
      | 'readFileContent']
  >(method: TMethod, uri: Parameters<TMethod>[0], ...otherArgs: any[]): ReturnType<TMethod> {
    const operationName = `${this.#strategy.constructor.name || 'strategy'}.${method.name}`;
    const uriStr = uri.toString();
    let operationCache = this.#cache.get(operationName) as
      | Map<string, ReturnType<TMethod>>
      | undefined;

    if (!operationCache) {
      operationCache = new Map();
      this.#cache.set(operationName, operationCache);
    }

    const cached = operationCache.get(uriStr);

    if (cached) {
      this.debug('%s(%s) [HIT]', operationName, uriStr);

      // We either have a cached result or a cached promise for a result. Either way, the value
      // is suitable as a return.
      return cached;
    }

    this.debug('%s(%s) [MISS]', operationName, uriStr);

    // Nothing is cached
    const ret = (method as any).call(
      this.#strategy,
      uri,
      ...otherArgs,
      this.withOperation(operationName, uri)
    ) as ReturnType<TMethod>;

    if (isThenable(ret)) {
      const promiseRet = ret as Thenable<ReturnType<TMethod>>;

      // Produce a promise that will only be settled once the cache has been updated accordingly.
      const wrappedRet = promiseRet.then(
        (result) => {
          // Override the pending value with the resolved value
          operationCache!.set(uriStr, result);

          return result;
        },
        (err) => {
          // Delete the entry from the cache in case it was a transient failure
          operationCache!.delete(uriStr);

          return Promise.reject(err);
        }
      );

      // Set the pending value in the cache for now
      operationCache.set(uriStr, wrappedRet as Awaited<Thenable<ReturnType<TMethod>>>);

      return wrappedRet as Awaited<Thenable<ReturnType<TMethod>>>;
    }

    operationCache.set(uriStr, ret);

    return ret;
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
