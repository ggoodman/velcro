import { CancellationToken, Thenable } from 'ts-primitives';

// import { isThenable, Awaited } from './async';
import { Decoder } from './decoder';
import { Settings } from './settings';
import { ResolverStrategy } from './strategy';
import { Uri } from './uri';
import { isThenable, Awaited } from './async';
import { Resolver } from './resolver';

interface ResolverContextOptions {
  cache: Map<string, Map<string, unknown>>;
  decoder: Decoder;
  path: string[];
  resolver: Resolver;
  settings: Settings;
  strategy: ResolverStrategy;
  token: CancellationToken;
  uri: string;
  visited: Set<string>;
}

export class ResolverContext {
  static create(
    uri: string,
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
      uri,
      visited: new Set(),
    });
  }

  readonly #cache: ResolverContextOptions['cache'];
  readonly #decoder: ResolverContextOptions['decoder'];
  readonly #path: ResolverContextOptions['path'];
  readonly #resolver: ResolverContextOptions['resolver'];
  readonly #settings: ResolverContextOptions['settings'];
  readonly #strategy: ResolverContextOptions['strategy'];
  readonly #token: ResolverContextOptions['token'];
  readonly #uri: ResolverContextOptions['uri'];
  readonly #visited: ResolverContextOptions['visited'];

  private constructor(options: ResolverContextOptions) {
    this.#cache = options.cache;
    this.#decoder = options.decoder;
    this.#path = options.path;
    this.#resolver = options.resolver;
    this.#settings = options.settings;
    this.#strategy = options.strategy;
    this.#token = options.token;
    this.#uri = options.uri;
    this.#visited = options.visited;
  }

  get decoder() {
    return this.#decoder;
  }

  get settings() {
    return this.#settings as Readonly<Settings>;
  }

  get token() {
    return this.#token;
  }

  get visited() {
    return this.#visited;
  }

  get uri() {
    return this.#uri;
  }

  getCanonicalUrl(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getCanonicalUrl, uri);
  }

  getRootUrl(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getRootUrl, uri);
  }

  getResolveRoot(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getResolveRoot, uri);
  }

  getSettings(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.getSettings, uri);
  }

  getUrlForBareModule(spec: string) {
    const method = this.#strategy.getUrlForBareModule;

    if (!method) {
      return Promise.reject(
        new Error(
          `Unable to resolve bare module spec '${spec}' because no strategy was found that supports resolving bare modules`
        )
      );
    }

    return this._invokeStrategyMethod(method, spec);
  }

  listEntries(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.listEntries, uri);
  }

  readFileContent(uri: Uri) {
    return this._invokeStrategyMethod(this.#strategy.readFileContent, uri);
  }

  readParentPackageJson(uri: Uri) {
    return this._invokeResolverMethod(this.#resolver.readParentPackageJson, uri);
  }

  resolve(uri: Uri) {
    return this._invokeResolverMethod(this.#resolver.resolve, uri);
  }

  withOperation(operationName: string, uri: Uri | string) {
    const encodedOperation = encodePathNode(operationName, uri);

    if (this.#path.includes(encodedOperation)) {
      const formattedPath = this.#path
        .map((segment) => {
          const { operationName, uri } = decodePathNode(segment);

          return `${operationName}(${uri.toString()})`;
        })
        .join(' -> ');

      return Promise.reject(
        this._wrapError(
          new Error(
            `Detected a recursive call to the operation '${operationName}' for '${uri.toString(
              true
            )}' at path '${formattedPath}'`
          )
        )
      );
    }

    return new ResolverContext({
      cache: this.#cache,
      decoder: this.#decoder,
      path: this.#path.concat(encodedOperation),
      resolver: this.#resolver,
      settings: this.#settings,
      strategy: this.#strategy,
      token: this.#token,
      uri: this.#uri,
      visited: this.#visited,
    });
  }

  private _invokeResolverMethod<TMethod extends Resolver['resolve' | 'readParentPackageJson']>(
    method: TMethod,
    uri: Uri
  ): ReturnType<TMethod> {
    const operationName = `resolver.${method.name}`;
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
    const ret = (method as any).call(this.#resolver, uri, {
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
      | 'getRootUrl'
      | 'getResolveRoot'
      | 'getSettings'
      | 'getUrlForBareModule'
      | 'listEntries'
      | 'readFileContent']
  >(method: TMethod, uri: Parameters<TMethod>[0]): ReturnType<TMethod> {
    const operationName = `strategy.${method.name}`;
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
    if (typeof args[0] === 'string') {
      args[0] = ' '.repeat(this.#path.length) + args[0];
    }
    // console.debug(...args);
  }
}

function encodePathNode(operationName: string, uri: { toString(): string }) {
  return `${operationName}:${uri.toString()}`;
}

function decodePathNode(node: string) {
  const parts = node.split(':');

  if (parts.length !== 2) {
    throw new Error(`Invariant violation: Unexpected path node: '${node}'`);
  }

  return {
    operationName: parts[0],
    uri: parts[1].includes(':') ? Uri.parse(parts[1]) : parts[1],
  };
}
