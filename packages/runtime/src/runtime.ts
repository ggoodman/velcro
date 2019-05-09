import { Resolver, util } from '@velcro/resolver';

import { CommonJsAsset } from './assets/commonjs';
import { UnresolvedAsset } from './assets/unresolved_asset';
import { Awaitable, BareModuleResolver } from './types';
import { isBareModuleSpecifier, log } from './util';
import { JsonAsset } from './assets/json';
import { InjectedJsAsset } from './assets/injected';
import { WebpackLoaderAsset } from './assets/webpack';

interface ICache<T extends Record<string, any>> {
  clear<TSegment extends keyof T>(segment?: TSegment): Awaitable<unknown>;
  delete<TSegment extends keyof T>(segment: TSegment, key: string): Awaitable<unknown>;
  get<TSegment extends keyof T>(segment: TSegment, key: string): Awaitable<T[TSegment] | undefined>;
  set<TSegment extends keyof T>(segment: TSegment, key: string, value: T[TSegment]): Awaitable<unknown>;
}

type Registry = Map<string, RegistryEntry>;
type RegistryEntry = {
  asset: Runtime.Asset;
  dependencies: Set<RegistryEntry>;
  dependents: Set<RegistryEntry>;
  err: Error | undefined;
  executed: boolean;
  executeFunction: Runtime.ExecuteFunction | undefined;
  loaded: boolean;
  loadedPromise?: ReturnType<Runtime.Asset['load']>;
};

export class Runtime {
  private readonly assetHost: Runtime.AssetHost;
  private readonly cache: Runtime.Cache | undefined = undefined;
  private readonly fileDependents = new Map<string, Set<RegistryEntry>>();
  private readonly inflightResolutions = new Map<string, Promise<string | undefined>>();
  private readonly registry: Registry = new Map();
  private readonly rules: Runtime.Options['rules'];

  public readonly resolveBareModule: BareModuleResolver;
  public readonly resolver: Resolver;

  constructor(options: Runtime.Options) {
    this.assetHost = {
      decodeBuffer: buffer => this.resolver.decoder.decode(buffer),
      import: this.import.bind(this),
      injectGlobal: options.injectGlobal,
      injectUnresolvedFallback: () => {
        let entry = this.registry.get(UnresolvedAsset.id);

        if (!entry) {
          entry = {
            asset: new UnresolvedAsset(),
            dependencies: new Set(),
            dependents: new Set(),
            err: undefined,
            executeFunction: undefined,
            executed: true,
            loaded: true,
            loadedPromise: undefined,
          };

          this.registerEntry(entry);
        }

        return entry.asset.id;
      },
      readFileContent: async (href: string) => {
        const resolvedHref = await this.resolve(href);

        if (!resolvedHref) {
          throw new Error(`Unable to read ${href} because it could not be resolved to a canonical url`);
        }

        let url: URL;

        try {
          url = new URL(resolvedHref);
        } catch (err) {
          throw new Error(`Unable to read ${resolvedHref} because it could not be parsed as a valid url`);
        }

        return this.resolver.host.readFileContent(this.resolver, url);
      },
      readParentPackageJson: async (href: string) => {
        const result = await this.resolver.readParentPackageJson(new URL(href));

        if (result) {
          return {
            href: result.url.href,
            packageJson: result.packageJson,
          };
        }
      },
      require: (id: string, fromId?: string) => {
        const entry = this.registry.get(id);

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
      resolveAssetReference: (id: string, fromId?: string) => this.resolveAssetReference(id, fromId),
      resolveBareModule: (id: string, fromId?: string) => options.resolveBareModule(this, this.resolver, id, fromId),
    };
    this.cache = options.cache;
    this.resolver = options.resolver;
    this.resolveBareModule = options.resolveBareModule;
    this.rules = options.rules;

    // Seed the registry with the unresolved module
    this.assetHost.injectUnresolvedFallback();
  }

  private createAsset(assetRef: Runtime.AssetReference, _fromId?: string): Runtime.Asset {
    if (assetRef.loaders.length || assetRef.id.startsWith('!')) {
      const fromEntry = this.registry.get(assetRef.resource);

      return new WebpackLoaderAsset(
        assetRef.id,
        this.assetHost,
        fromEntry && fromEntry.asset instanceof WebpackLoaderAsset ? fromEntry.asset.fromId : _fromId,
        assetRef.loaders
      );
    }

    if (assetRef.resource.endsWith('.json')) {
      return new JsonAsset(assetRef.resource, this.assetHost);
    }

    return new CommonJsAsset(assetRef.resource, this.assetHost);
  }

  private getOrCreateEntry(assetRef: Runtime.AssetReference, fromId?: string): RegistryEntry {
    let entry = this.registry.get(assetRef.id);

    if (!entry) {
      const asset = this.createAsset(assetRef, fromId);
      entry = {
        asset,
        dependencies: new Set(),
        dependents: new Set(),
        err: undefined,
        executeFunction: undefined,
        executed: false,
        loaded: false,
        loadedPromise: undefined,
      };

      this.registerEntry(entry);
    }

    return entry;
  }

  async import(id: string | URL, fromId?: string): Promise<any> {
    if (id instanceof URL) {
      id = id.href;
    }

    const assetRef = await this.resolveAssetReference(id, fromId);

    log('Velcro.import(%s, %s) => %s', id, fromId, assetRef);

    const entry = this.getOrCreateEntry(assetRef, fromId);

    await this.loadEntry(entry);

    log('Velcro.import(%s, %s) dependencies loaded', id, fromId);

    const exports = this.assetHost.require(entry.asset.id, fromId);

    return exports;
  }

  async invalidate(id: string | URL, fromId?: string): Promise<boolean> {
    if (id instanceof URL) {
      id = id.href;
    }

    // Get the canonical url of the underlying resource
    const assetRef = await this.resolveAssetReference(id, fromId);
    const resolutionCacheKey = `${id}#${fromId}`;

    let invalidated = false;

    log('Runtime.invalidate(%s, %s): %s', id, fromId, assetRef.id);

    if (!assetRef) {
      throw new Error(`The asset ${id} did not resolve to anything using the node module resolution algorithm`);
    }

    if (this.cache) {
      await Promise.all([
        this.cache.delete(Runtime.CacheSegment.Resolution, resolutionCacheKey),
        this.cache.delete(Runtime.CacheSegment.Registration, assetRef.id),
      ]);
    }

    const entry = this.registry.get(assetRef.id);
    /**
     * A queue of **resolved** ids
     */
    const queue: RegistryEntry[] = [];
    const seen = new Set<RegistryEntry>();

    if (entry) {
      queue.push(entry);
    }

    const dependentEntries = this.fileDependents.get(assetRef.id);

    if (dependentEntries) {
      queue.push(...dependentEntries);
    }

    while (queue.length) {
      const entry = queue.shift() as RegistryEntry;

      if (seen.has(entry)) continue;
      seen.add(entry);

      invalidated = true;

      if (this.cache) {
        await this.cache.delete(Runtime.CacheSegment.Registration, entry.asset.id);
      }

      log('Runtime.invalidate(%s, %s): Deleting %s', id, fromId, entry.asset.id);
      this.registry.delete(entry.asset.id);

      queue.push(...entry.dependents);
    }

    return invalidated;
  }

  async load(id: string | URL, fromId?: string) {
    if (id instanceof URL) {
      id = id.href;
    }

    const assetRef = await this.resolveAssetReference(id, fromId);

    log('Velcro.import(%s, %s) => %s', id, fromId, assetRef);

    const entry = this.getOrCreateEntry(assetRef, fromId);

    return this.loadEntry(entry);
  }

  private async loadEntry(entry: RegistryEntry, seen: Set<RegistryEntry> = new Set()) {
    if (!seen.has(entry)) {
      seen.add(entry);

      if (entry.loadedPromise) {
        await entry.loadedPromise;
      }

      await Promise.all(Array.from(entry.dependencies).map(dependencyEntry => this.loadEntry(dependencyEntry, seen)));
    }
  }

  private registerEntry(entry: RegistryEntry) {
    if (!entry.loaded) {
      const cacheKey = entry.asset.id;

      if (!entry.loadedPromise) {
        entry.loadedPromise = (async () => {
          let loaded: Runtime.LoadedModule | undefined;
          let cached = false;

          if (this.cache) {
            loaded = await this.cache.get(Runtime.CacheSegment.Registration, cacheKey);
            cached = !!loaded;
          }

          if (!loaded) {
            try {
              log('Velcro.registerEntry(%s) cacheKey: %s, type: %s', entry.asset.id, cacheKey, 'MISS');
              loaded = await entry.asset.load();
            } catch (err) {
              entry.loaded = true;
              entry.err = err;

              throw err;
            }
          } else {
            log('Velcro.registerEntry(%s) cacheKey: %s, type: %s', entry.asset.id, cacheKey, 'HIT');
          }

          if (loaded.cacheable && this.cache && !cached) {
            await this.cache.set(Runtime.CacheSegment.Registration, cacheKey, loaded);
          }

          const { code, fileDependencies, moduleDependencies, type } = loaded;
          let execute: Runtime.ExecuteFunction;

          switch (type) {
            case Runtime.ModuleKind.CommonJs:
              execute = createCommonJsExecuteFunction(entry.asset, this.assetHost, code);
              break;
            default:
              throw new Error(
                `Unable to load ${entry.asset.id} because it produced an unsupported module format ${type}`
              );
          }

          for (const dependency of moduleDependencies) {
            const dependencyEntry = this.getOrCreateEntry(dependency, entry.asset.id);
            entry.dependencies.add(dependencyEntry);
            dependencyEntry.dependents.add(entry);
          }

          for (const dependency of fileDependencies) {
            let dependents = this.fileDependents.get(dependency);

            if (!dependents) {
              dependents = new Set();
              this.fileDependents.set(dependency, dependents);
            }

            dependents.add(entry);
          }

          entry.loaded = true;
          entry.executeFunction = execute;

          return loaded;
        })();
        entry.loadedPromise;
      } else {
        log('Velcro.registerEntry(%s) cacheKey: %s, type: %s', entry.asset.id, cacheKey, 'INFLIGHT');
      }
    }

    this.registry.set(entry.asset.id, entry);
  }

  async resolve(id: string | URL, fromId?: string): Promise<string | undefined> {
    if (id instanceof URL) {
      id = id.href;
    }

    const cacheKey = `${id}#${fromId}`;

    let inflightResolution = this.inflightResolutions.get(cacheKey);

    if (!inflightResolution) {
      inflightResolution = (async () => {
        if (this.cache) {
          const cached = await this.cache.get(Runtime.CacheSegment.Resolution, cacheKey);

          if (cached) {
            log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'HIT');
            return cached;
          }
        }

        log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'MISS');

        let cacheable = true;
        let resolvedId: string | undefined = undefined;

        if (isBareModuleSpecifier(id)) {
          resolvedId = await this.resolveBareModule(this, this.resolver, id, fromId);

          if (!resolvedId) {
            const fromMsg = fromId ? ` from ${fromId}` : '';
            throw new Error(
              `Unable to resolve the bare module ${id}${fromMsg}. Have you checked to make sure that your dependencies or devDependencies include ${id}?`
            );
          }
        } else {
          const url = parseUrl(id, fromId);
          const resolvedUrl = await this.resolver.resolve(url);

          if (resolvedUrl) {
            resolvedId = resolvedUrl.href;
          } else if (resolvedUrl === false) {
            // We should inject an unresolved fallback
            resolvedId = this.assetHost.injectUnresolvedFallback();
          }
        }

        if (!resolvedId) {
          const fromMsg = fromId ? ` from ${fromId}` : '';
          throw new Error(`Failed to resolve ${id}${fromMsg}`);
        }

        if (cacheable && this.cache) {
          await this.cache.set(Runtime.CacheSegment.Resolution, cacheKey, resolvedId);
        }

        return resolvedId;
      })();

      this.inflightResolutions.set(cacheKey, inflightResolution);
    } else {
      log('Velcro.resolve(%s, %s) cacheKey: %s, type: %s', id, fromId, cacheKey, 'INFLIGHT');
    }

    return inflightResolution;
  }

  private async resolveAssetReference(unresolvedId: string, fromId?: string): Promise<Runtime.AssetReference> {
    const resolveLoaderWithOptions = async (rawLoader: string, options: any = undefined) => {
      const loader = await this.resolve(rawLoader, fromId);

      if (!loader) {
        throw new Error(`The loader ${rawLoader} required by ${unresolvedId} failed to load`);
      }

      return { loader, options };
    };

    const matches = unresolvedId.match(/^(!!?)(.*)$/);

    if (matches) {
      // For urls that are already encoded as webpack-specific urls
      const [, prefix, body] = matches;
      const bodyParts = body.split('!');
      const resource = await this.resolve(bodyParts.pop() as string, fromId);

      if (!resource) {
        throw new Error(
          `The asset ${unresolvedId} did not resolve to anything using the node module resolution algorithm`
        );
      }

      const loaders = await Promise.all(
        bodyParts.map(async part => {
          const matches = part.match(/^([^?]+)(?:\?(.*))?$/);

          if (!matches) {
            return { loader: part, options: undefined };
          }

          const [, path, query] = matches;

          return await resolveLoaderWithOptions(path, query ? JSON.parse(query) : '');
        })
      );

      const id = `${prefix}${[
        ...loaders.map(loader => `${loader.loader}${loader.options ? `?${JSON.stringify(loader.options)}` : ''}`),
        resource,
      ].join('!')}`;

      return {
        id,
        loaders,
        resource,
      };
    }

    const resource = await this.resolve(unresolvedId, fromId);

    if (!resource) {
      throw new Error(
        `The asset ${unresolvedId} did not resolve to anything using the node module resolution algorithm`
      );
    }

    if (this.rules) {
      let matchedRule = false;

      const loaders = [] as Array<{ loader: string; options: string | {} }>;
      for (const rule of this.rules) {
        const applicable =
          (!rule.include || rule.include.test(resource)) &&
          (!rule.exclude || !rule.exclude.test(resource)) &&
          (!rule.test || rule.test.test(resource));

        if (applicable) {
          const ruleLoaders = await Promise.all(
            rule.use.map(useLoader => resolveLoaderWithOptions(useLoader.loader, useLoader.options))
          );

          loaders.push(...ruleLoaders);

          matchedRule = true;
        }
      }

      if (matchedRule) {
        const id = `!!${[
          ...loaders.map(loader => `${loader.loader}${loader.options ? `?${JSON.stringify(loader.options)}` : ''}`),
          resource,
        ].join('!')}`;

        return {
          id,
          loaders,
          resource,
        };
      }
    }

    return {
      id: resource,
      loaders: [],
      resource,
    };
  }

  set(id: string, moduleNamespace: any) {
    const asset = new InjectedJsAsset(id, moduleNamespace);
    const entry: RegistryEntry = {
      asset,
      dependencies: new Set(),
      dependents: new Set(),
      err: undefined,
      executeFunction: undefined,
      executed: true,
      loaded: true,
      loadedPromise: asset.load(),
    };

    this.registry.set(id, entry);
  }
}

export namespace Runtime {
  export let debug = false;

  export interface Asset {
    readonly id: string;
    readonly exports: any;
    readonly module: { exports: any; hot?: HotModuleInterface };

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
    injectUnresolvedFallback(): string;
    /**
     * Read the content of an asset at a url as a binary buffer
     */
    readFileContent(href: string): Promise<ArrayBuffer>;
    /**
     * Read the content of an asset at a url as a binary buffer
     */
    readParentPackageJson(href: string): Promise<{ href: string; packageJson: any } | undefined>;
    /**
     * Require a module by exececuting the asset, if necessary
     */
    require(id: string, fromId?: string): any;
    /**
     * Attempt to resolve a reference to an asset in the context of an optional parent asset
     */
    resolve(id: string, fromId?: string): Awaitable<string | undefined>;
    /**
     * Attempt to resolve a reference to an asset in the context of an optional parent asset
     */
    resolveAssetReference(id: string, fromId?: string): Awaitable<AssetReference>;
    /**
     * Attempt to resolve a bare module reference in the context of an optional parent asset
     */
    resolveBareModule(id: string, fromId?: string): Awaitable<string | undefined>;
  }

  export interface AssetReference {
    id: string;
    loaders: Array<{ loader: string; options: any }>;
    resource: string;
  }

  export enum CacheSegment {
    Registration = 'registration',
    Resolution = 'resolution',
  }

  export type Cache = ICache<{
    [CacheSegment.Registration]: LoadedModule;
    [CacheSegment.Resolution]: string;
  }>;

  export type ExecuteFunction = () => void;

  type GlobalInjection = { spec: string; export?: string };

  export type GlobalInjector = AssetHost['injectGlobal'];

  export interface HotModuleInterface {
    /** Accept updates for the given `dependencies` and fire a `callback` to react to those updates. */
    accept(dependencies: string | string[], callback?: (err?: Error) => void): void;
    /** Accept updates for itself. */
    accept(callback?: (err: Error) => void): void;
    /**
     * Add a handler which is executed when the current module code is replaced.
     *
     * @alias dispose
     */
    addDisposeHandler(callback: (data: any) => void): void;
    /** Reject updates for the given `dependencies` forcing the update to fail with a `decline` code. */
    decline(dependencies: string | string[]): void;
    /** Reject updates for itself. */
    decline(): void;
    /**
     * Add a handler which is executed when the current module code is replaced.
     *
     * This should be used to remove any persistent resource you have claimed or created. If you want to transfer state to the updated module, add it to given data parameter. This object will be available at module.hot.data after the update.
     */
    dispose(callback: (data: any) => void): void;

    /** Remove the callback added via `dispose` or `addDisposeHandler`. */
    removeDisposeHandler(callback: (data: any) => void): void;
  }

  export enum HotModuleRuntimeStatus {
    /** The process is waiting for a call to `check` */
    Idle = 'idle',
    /** The process is checking for updates */
    Check = 'check',
    /** The process is getting ready for the update (e.g. downloading the updated module) */
    Prepare = 'prepare',
    /** The update is prepared and available */
    Ready = 'ready',
    /** The process is calling the `dispose` handlers on the modules that will be replaced */
    Dispose = 'dispose',
    /** The process is calling the accept handlers and re-executing self-accepted modules */
    Apply = 'apply',
    /** An update was aborted, but the system is still in its previous state */
    Abort = 'abort',
    /** An update has thrown an exception and the system's state has been compromised */
    Fail = 'fail',
  }

  export interface LoadedModule {
    cacheable: boolean;
    code: string;
    fileDependencies: string[];
    moduleDependencies: Runtime.AssetReference[];
    type: ModuleKind;
  }

  export enum ModuleKind {
    CommonJs = 'commonjs',
  }

  export interface Options {
    cache?: Runtime.Cache;
    injectGlobal?: GlobalInjector;
    resolveBareModule: BareModuleResolver;
    resolver: Resolver;
    rules?: Rules;
  }

  interface Rule {
    exclude?: RegExp;
    include?: RegExp;
    test?: RegExp;
    use: Array<UseEntry>;
  }

  type Rules = Array<Rule>;

  interface UseEntry {
    loader: string;
    options?: string | {};
  }
}

export function createCommonJsExecuteFunction(asset: Runtime.Asset, host: Runtime.AssetHost, code: string) {
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
