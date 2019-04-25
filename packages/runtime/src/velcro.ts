import { Resolver, util } from '@velcro/resolver';

import { CommonJsAsset } from './assets/commonjs';
import { UnresolvedAsset } from './assets/unresolved_asset';
import { Awaitable, BareModuleResolver } from './types';
import { isBareModuleSpecifier, log } from './util';
import { JsonAsset } from './assets/json';
import { InjectedJsAsset } from './assets/injected';

interface ICache<T extends Record<string, any>> {
  delete<TSegment extends keyof T>(segment: TSegment, key: string): Promise<unknown>;
  get<TSegment extends keyof T>(segment: TSegment, key: string): Promise<T[TSegment] | undefined>;
  set<TSegment extends keyof T>(segment: TSegment, key: string, value: T[TSegment]): Promise<unknown>;
}

type Registry = Map<string, RegistryEntry>;
type RegistryEntry = {
  asset: Velcro.Asset;
  dependencies: Set<RegistryEntry>;
  err: Error | undefined;
  executed: boolean;
  executeFunction: Velcro.ExecuteFunction | undefined;
  loaded: boolean;
  loadedPromise: ReturnType<Velcro.Asset['load']>;
};

export class Velcro {
  private readonly _assetHost: Velcro.AssetHost;
  private readonly _cache: Velcro.Cache | undefined = undefined;
  private readonly _inflightImports = new Map<string, Promise<any>>();
  private readonly _inflightResolutions = new Map<string, Promise<string | undefined>>();
  private readonly _registry: Registry = new Map();

  public readonly resolveBareModule: BareModuleResolver;
  public readonly resolver: Resolver;

  constructor(options: Velcro.Options) {
    this._assetHost = {
      decodeBuffer: buffer => this.resolver.decoder.decode(buffer),
      import: this.import.bind(this),
      injectGlobal: options.injectGlobal,
      injectUnresolvedFallback: (id: string, fromId?: string) => {
        const asset = new UnresolvedAsset(id, fromId);
        const entry: RegistryEntry = {
          asset,
          dependencies: new Set(),
          err: undefined,
          executeFunction: undefined,
          executed: true,
          loaded: true,
          loadedPromise: asset.load(),
        };

        this.registerEntry(entry);

        return asset.id;
      },
      readFileContent: (href: string) => {
        let url: URL;

        try {
          url = new URL(href);
        } catch (err) {
          throw new Error(`Unable to read ${href} because it could not be parsed as a valid url`);
        }

        return this.resolver.host.readFileContent(this.resolver, url);
      },
      require: (id: string, fromId?: string) => {
        const entry = this._registry.get(id);

        if (!entry) {
          throw new Error(`Module not found ${id}${fromId ? ` from ${fromId}` : ''}`);
        }

        if (!entry.loaded) {
          throw new Error(`Module not loaded ${id}${fromId ? ` from ${fromId}` : ''}`);
        }

        if (!entry.executed) {
          if (!entry.executeFunction) {
            throw new Error(`Module not loaded ${id}${fromId ? ` from ${fromId}` : ''}`);
          }

          log('AssetHost.require(%s, %s)', id, fromId);
          entry.executed = true;
          entry.executeFunction();
        }

        if (entry.err) {
          throw entry.err;
        }

        return entry.asset.exports;
      },
      resolve: (id: string, fromId?: string) => this.resolve(id, fromId),
      resolveBareModule: (id: string, fromId?: string) => options.resolveBareModule(this, this.resolver, id, fromId),
    };
    this._cache = options.cache;
    // this._injectGlobal = options.injectGlobal;
    this.resolver = options.resolver;
    this.resolveBareModule = options.resolveBareModule;
  }

  private createAsset(id: string, _fromId?: string) {
    if (id.endsWith('.json')) {
      return new JsonAsset(id, this._assetHost);
    }

    return new CommonJsAsset(id, this._assetHost);
  }

  private getOrCreateEntry(id: string, fromId?: string): RegistryEntry {
    let entry = this._registry.get(id);

    if (!entry) {
      const asset = this.createAsset(id, fromId);
      entry = {
        asset,
        dependencies: new Set(),
        err: undefined,
        executeFunction: undefined,
        executed: false,
        loaded: false,
        loadedPromise: asset.load(),
      };

      this.registerEntry(entry);
    }

    return entry;
  }

  async import(id: string, fromId?: string): Promise<any> {
    // Get the canonical url of the underlying resource
    const resolvedId = await this.resolve(id, fromId);

    if (!resolvedId) {
      throw new Error(`The asset ${id} did not resolve to anything using the node module resolution algorithm`);
    }

    const cacheKey = `${id}#${fromId}`;

    let inflightImport = this._inflightImports.get(cacheKey);

    log('Velcro.import(%s, %s) cacheKey: %s, inflight: %s', id, fromId, cacheKey, !!inflightImport);

    const entry = this.getOrCreateEntry(resolvedId, fromId);

    await this.loadEntry(entry);

    log('Velcro.import(%s, %s) dependencies loaded', id, fromId);

    return this._assetHost.require(entry.asset.id, fromId);
  }

  async load(id: string, fromId?: string) {
    // Get the canonical url of the underlying resource
    const resolvedId = await this.resolve(id, fromId);

    if (!resolvedId) {
      throw new Error(`The asset ${id} did not resolve to anything using the node module resolution algorithm`);
    }

    const cacheKey = `${id}#${fromId}`;

    let inflightImport = this._inflightImports.get(cacheKey);

    log('Velcro.import(%s, %s) cacheKey: %s, inflight: %s', id, fromId, cacheKey, !!inflightImport);

    const entry = this.getOrCreateEntry(resolvedId, fromId);

    return this.loadEntry(entry);
  }

  private async loadEntry(entry: RegistryEntry, seen: Set<RegistryEntry> = new Set()) {
    if (!seen.has(entry)) {
      seen.add(entry);

      await entry.loadedPromise;

      await Promise.all(Array.from(entry.dependencies).map(dependencyEntry => this.loadEntry(dependencyEntry, seen)));
    }
  }

  private registerEntry(entry: RegistryEntry) {
    if (!entry.loaded) {
      entry.loadedPromise.then(
        ({ code, dependencies, type }) => {
          let execute: Velcro.ExecuteFunction;

          switch (type) {
            case Velcro.ModuleKind.CommonJs:
              execute = createCommonJsExecuteFunction(entry.asset, this._assetHost, code);
              break;
            default:
              throw new Error(
                `Unable to load ${entry.asset.id} because it produced an unsupported module format ${type}`
              );
          }

          for (const dependency of dependencies) {
            entry.dependencies.add(this.getOrCreateEntry(dependency, entry.asset.id));
          }

          entry.loaded = true;
          entry.executeFunction = execute;
        },
        err => {
          entry.loaded = true;
          entry.err = err;
        }
      );
    }

    this._registry.set(entry.asset.id, entry);
  }

  async resolve(id: string, fromId?: string): Promise<string | undefined> {
    const cacheKey = `${id}#${fromId}`;

    let inflightResolution = this._inflightResolutions.get(cacheKey);

    if (!inflightResolution) {
      inflightResolution = (async () => {
        if (this._cache) {
          const cached = await this._cache.get(Velcro.CacheSegment.Resolution, cacheKey);

          if (cached) {
            log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'HIT');
            return cached;
          }
        }

        log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'MISS');

        let cacheable = true;
        let resolvedId: string | undefined = undefined;

        if (isBareModuleSpecifier(id)) {
          resolvedId =
            (await this.resolveBareModule(this, this.resolver, id, fromId)) ||
            this._assetHost.injectUnresolvedFallback(id, fromId);
        } else {
          const url = parseUrl(id, fromId);
          const resolvedUrl = await this.resolver.resolve(url);

          if (resolvedUrl) {
            resolvedId = resolvedUrl.href;
          }
        }

        if (!resolvedId) {
          cacheable = false;
          resolvedId = this._assetHost.injectUnresolvedFallback(id, fromId);
        }

        if (cacheable && this._cache) {
          await this._cache.set(Velcro.CacheSegment.Resolution, cacheKey, resolvedId);
        }

        return resolvedId;
      })();

      this._inflightResolutions.set(cacheKey, inflightResolution);
    } else {
      log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'INFLIGHT');
    }

    return inflightResolution;
  }

  set(id: string, moduleNamespace: any) {
    const asset = new InjectedJsAsset(id, moduleNamespace);
    const entry: RegistryEntry = {
      asset,
      dependencies: new Set(),
      err: undefined,
      executeFunction: undefined,
      executed: true,
      loaded: true,
      loadedPromise: asset.load(),
    };

    this._registry.set(id, entry);
  }
}

export namespace Velcro {
  export let debug = false;

  export interface Asset {
    readonly id: string;
    readonly exports: any;
    readonly module: { exports: any };

    load(): Promise<LoadedModule>;
  }

  export interface AssetHost {
    /**
     * Decode a binary buffer as a string
     */
    decodeBuffer(buffer: BufferSource): string;
    /**
     * Import a module, optionally relative to another
     */
    import(id: string, fromId?: string): Promise<any>;
    /**
     * Attempt to resolve a module that will provide the functionality expected by a global
     */
    injectGlobal?(globalName: string): GlobalInjection | undefined;
    /**
     * Create and inject an Asset into the registry to represent an asset that could not be resolved
     */
    injectUnresolvedFallback(id: string, fromId?: string): string;
    /**
     * Read the content of an asset at a url as a binary buffer
     */
    readFileContent(href: string): Promise<ArrayBuffer>;
    /**
     * Require a module by exececuting the asset, if necessary
     */
    require(id: string, fromId?: string): any;
    /**
     * Attempt to resolve a reference to an asset in the context of an optional parent asset
     */
    resolve(id: string, fromId?: string): Awaitable<string | undefined>;
    /**
     * Attempt to resolve a bare module reference in the context of an optional parent asset
     */
    resolveBareModule(id: string, fromId?: string): Awaitable<string | undefined>;
  }

  export enum CacheSegment {
    // Registration = 'registration',
    Resolution = 'resolution',
  }

  export type Cache = ICache<{
    // [CacheSegment.Registration]: ParsedAsset;
    [CacheSegment.Resolution]: string;
  }>;

  export type ExecuteFunction = () => void;

  type GlobalInjection = { spec: string; export?: string };

  export type GlobalInjector = AssetHost['injectGlobal'];

  export type LoadedModule = { cacheable: boolean; code: string; dependencies: string[]; type: ModuleKind };

  export enum ModuleKind {
    CommonJs = 'commonjs',
  }

  export interface Options {
    cache?: Velcro.Cache;
    injectGlobal?: GlobalInjector;
    resolveBareModule: BareModuleResolver;
    resolver: Resolver;
  }
}

export function createCommonJsExecuteFunction(asset: Velcro.Asset, host: Velcro.AssetHost, code: string) {
  const invoke = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    `${code}\n//# sourceURL=${asset.id}`
  );
  const __dirname = util.dirname(asset.id);
  const __filename = util.basename(asset.id);

  return () => {
    const require = Object.assign(
      function require(id: string) {
        return host.require(id, asset.id);
      },
      {
        resolve(id: string) {
          return id;
        },
      }
    );

    invoke(asset.exports, require, asset.module, __filename, __dirname);
  };
}

function parseUrl(id: string, fromId?: string): URL {
  try {
    const url = new URL(id, fromId);

    return url;
  } catch {
    const fromSuffix = fromId ? ` relative to ${fromId}` : '';

    throw new Error(`Unable to create a valid url from ${id}${fromSuffix}`);
  }
}
