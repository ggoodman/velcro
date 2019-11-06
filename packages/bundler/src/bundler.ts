import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { CancellationToken, CancellationTokenSource, EntryNotFoundError, Resolver } from '@velcro/resolver';
import { Emitter, Event } from 'ts-primitives';

import { isBareModuleSpecifier, Deferred } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { Asset } from './asset';
import { InvariantViolation } from './error';
import { Bundle } from './bundle';

const EMPTY_MODULE_URL = new URL('velcro://@empty');
const EMPTY_MODULE_CODE = 'module.exports = function(){};';

const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
  Buffer: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/buffer.js`,
    export: 'Buffer',
  },
  global: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/global.js`,
  },
  process: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/process.js`,
  },
};

interface HrefEntrypoint {
  type: 'href';
  href: string;
}

interface InlineEntrypoint {
  type: 'inline';
  href: string;
  code: string;
}

type Entrypoint = HrefEntrypoint | InlineEntrypoint;

export class Bundler {
  readonly resolver: Resolver;

  private readonly assetsByHref = new Map<string, Asset>();
  // private readonly assetsByRootHref = new Map<string, Set<Asset>>();
  private readonly pendingResolves = new Map<string, Promise<Asset>>();

  private readonly onAssetAddedEmitter = new Emitter<Asset>();
  private readonly onAssetRemovedEmitter = new Emitter<Asset>();

  static readonly schemaVersion: 1;

  constructor(options: Bundler.Options) {
    this.resolver = options.resolver;
  }

  get onAssetAdded(): Event<Asset> {
    return this.onAssetAddedEmitter.event;
  }

  get onAssetRemoved(): Event<Asset> {
    return this.onAssetRemovedEmitter.event;
  }

  dispose() {
    this.onAssetAddedEmitter.dispose();
    this.onAssetRemovedEmitter.dispose();
    this.assetsByHref.clear();
    // this.assetsByRootHref.clear();
    this.pendingResolves.clear();
  }

  private getOrCreateAsset(href: string, rootHref: string): Asset {
    let asset = this.assetsByHref.get(href);

    if (!asset) {
      asset = new Asset(href, rootHref);
      this.assetsByHref.set(href, asset);
      this.onAssetAddedEmitter.fire(asset);
    }

    return asset;
  }

  async generateBundle(entrypoints: Entrypoint[], options: Bundler.BundleOptions = {}): Promise<Bundle> {
    if (!Array.isArray(entrypoints)) {
      throw new Error('Generating a bundle requires passing in an array of entrypoints');
    }
    const tokenSource = new CancellationTokenSource();
    const token = tokenSource.token;

    if (options.token) {
      if (options.token.isCancellationRequested) {
        tokenSource.cancel();
        tokenSource.dispose();
      }
      options.token.onCancellationRequested(() => {
        tokenSource.cancel();
        tokenSource.dispose();
      });
    }

    let pendingOperations = 0;
    const assets = new Set<Asset>();
    const dfd = new Deferred(token);
    const dependenciesToAssets = new Map<string, Asset>();
    const entrypointsToAssets = new Map<string, Asset>();

    const enqueue = async <T>(op: () => T | Promise<T>): Promise<T> => {
      try {
        pendingOperations++;

        if (options.onEnqueueAsset) {
          options.onEnqueueAsset();
        }

        const result = await op();

        if (options.onCompleteAsset) {
          options.onCompleteAsset();
        }

        pendingOperations--;

        if (pendingOperations < 0) {
          throw new InvariantViolation('Pending operations fell below zero');
        }

        if (pendingOperations === 0) {
          // Let's make sure this happens after the current microtask.
          setTimeout(() => dfd.resolve(), 0);
        }

        return result;
      } catch (err) {
        // Let's make sure this happens 'later'.
        if (!dfd.isSettled) {
          Promise.resolve()
            .then(() => dfd.reject(err))
            .catch(_ => undefined);
        }

        throw err;
      }
    };

    const resolveDependencies = async (asset: Asset, code: string): Promise<Asset> => {
      asset.setCode(code);

      const promises = [] as Promise<Asset.Dependency>[];

      for (const dependency of asset.unresolvedDependencies.requireDependencies) {
        if (dependency.spec.value === '@@runtime') {
          continue;
        }

        promises.push(
          enqueue(() => resolveAsset(dependency.spec.value, asset.href)).then(dependencyAsset => {
            return {
              type: Asset.DependencyKind.Require,
              href: dependencyAsset.href,
              rootHref: dependencyAsset.rootHref,
              callee: dependency.callee,
              spec: dependency.spec,
              value: dependency.spec.value,
            };
          })
        );
      }

      for (const dependency of asset.unresolvedDependencies.requireResolveDependencies) {
        promises.push(
          enqueue(() => resolveAsset(dependency.spec.value, asset.href)).then(dependencyAsset => {
            return {
              type: Asset.DependencyKind.RequireResolve,
              href: dependencyAsset.href,
              rootHref: dependencyAsset.rootHref,
              callee: dependency.callee,
              spec: dependency.spec,
              value: dependency.spec.value,
            };
          })
        );
      }

      for (const [symbolName, references] of asset.unresolvedDependencies.unboundSymbols) {
        const shim = DEFAULT_SHIM_GLOBALS[symbolName];

        if (shim) {
          promises.push(
            enqueue(() => resolveAsset(shim.spec, asset.href)).then(dependencyAsset => {
              return {
                type: Asset.DependencyKind.InjectedGlobal,
                href: dependencyAsset.href,
                rootHref: dependencyAsset.rootHref,
                references,
                exportName: shim.export,
                symbolName,
                value: `${shim.spec}${shim.export ? `[${JSON.stringify(shim.export)}]` : ''}`,
              };
            })
          );
        }
      }

      const dependencies = await Promise.all(promises);

      asset.dependencies.splice(0, asset.dependencies.length, ...dependencies);

      return asset;
    };

    const resolveAsset = async (spec: string, fromSpec?: string): Promise<Asset> => {
      const resolvedSpec = await this.resolveWithDetails(spec, fromSpec, {
        syntheticDependencies: options.dependencies,
        token,
      });
      const asset = this.getOrCreateAsset(resolvedSpec.resolvedHref, resolvedSpec.rootHref);

      // No need to re-process the same asset during the same operation
      if (!assets.has(asset)) {
        assets.add(asset);
        const code = await this.readCode(asset, { token });
        // No need to wait for this, but we do need to make sure it doesn't
        // generate an unhandled rejection.
        resolveDependencies(asset, code).catch(_ => undefined);
      }

      return asset;
    };

    if (options.dependencies) {
      for (const name in options.dependencies) {
        const dependency = options.dependencies[name];
        enqueue(() => resolveAsset(`${name}@${dependency}`)).then(
          asset => dependenciesToAssets.set(name, asset),
          _ => undefined
        );
      }
    }

    for (const idx in entrypoints) {
      const entrypoint = entrypoints[idx];

      // We need to add a catch handler because we might not catch all thrown exceptions,
      // only the first, via the dfd.promise.
      switch (entrypoint.type) {
        case 'href': {
          enqueue(() => resolveAsset(entrypoint.href)).then(
            asset => entrypointsToAssets.set(entrypoint.href, asset),
            _ => undefined
          );
          break;
        }
        case 'inline': {
          enqueue(() => {
            const asset = this.getOrCreateAsset(entrypoint.href, 'velcro:///');

            if (!assets.has(asset)) {
              assets.add(asset);
              return resolveDependencies(asset, entrypoint.code);
            }

            return asset;
          }).then(asset => entrypointsToAssets.set(entrypoint.href, asset), _ => undefined);
          break;
        }
        default: {
          throw new Error(`Unexpected entrypoint type '${(entrypoint as any).type}`);
        }
      }
    }

    await dfd.promise;

    return new Bundle(assets, entrypointsToAssets, dependenciesToAssets);
  }

  async invalidate(spec: string, { token }: { token?: CancellationToken } = {}): Promise<boolean> {
    let asset = this.assetsByHref.get(spec);

    if (!asset) {
      // We can't use Bundler::resolveWithDetails() because that will throw
      // when a module isn't found. We just want to attempt to resolve and
      // return true / false accordingly.
      let resolveResult: { resolvedUrl?: URL } | undefined = undefined;

      try {
        if (isBareModuleSpecifier(spec)) {
          resolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, spec, undefined, { token });
        } else {
          const combinedUri = new URL(spec);
          resolveResult = await this.resolver.resolve(combinedUri, { token });
        }
      } catch (err) {
        if (err instanceof EntryNotFoundError) {
          return false;
        }

        throw err;
      }

      if (!resolveResult || !resolveResult.resolvedUrl) {
        return false;
      }

      asset = this.assetsByHref.get(resolveResult.resolvedUrl.href);
    }

    if (asset) {
      this.removeAsset(asset);

      return true;
    }

    return false;
  }

  private removeAsset(asset: Asset): void {
    const hadAsset = this.assetsByHref.delete(asset.href);

    if (hadAsset) {
      this.onAssetRemovedEmitter.fire(asset);
    }
  }

  private async readCode(asset: Asset, { token }: { token: CancellationToken }): Promise<string> {
    if (asset.href === EMPTY_MODULE_URL.href) {
      return EMPTY_MODULE_CODE;
    }

    const buf = await this.resolver.host.readFileContent(this.resolver, new URL(asset.href), { token });
    const code = this.resolver.decoder.decode(buf);

    return code;
  }

  private async resolveWithDetails(
    uri: string,
    fromUri: string | undefined,
    { syntheticDependencies, token }: { syntheticDependencies?: Record<string, string>; token: CancellationToken }
  ): Promise<Bundler.ResolveDetails> {
    let resolved: Bundler.ResolveDetails;

    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri, {
        syntheticDependencies,
        token,
      });

      if (!bareModuleResolveResult.stableUrl) {
        throw new Error(`Failed to resolve bare module '${uri}' from '${fromUri || '@root'}' to a stable url`);
      }

      if (!bareModuleResolveResult.stableRootUrl) {
        throw new Error(`Failed to resolve bare module '${uri}' from '${fromUri || '@root'}' to a stable root url`);
      }

      const resolvedHref = bareModuleResolveResult.resolvedUrl
        ? bareModuleResolveResult.resolvedUrl.href
        : EMPTY_MODULE_URL.href;

      resolved = {
        type: Bundler.ResolveDetailsKind.BareModule,
        bareModule: {
          isBuiltIn: bareModuleResolveResult.bareModule.isBuiltIn,
          version: bareModuleResolveResult.bareModule.version,
          versionSpec: bareModuleResolveResult.bareModule.versionSpec,
        },
        ignored: bareModuleResolveResult.ignored,
        resolvedHref,
        rootHref: bareModuleResolveResult.rootUrl.href,
        stableHref: bareModuleResolveResult.stableUrl.href,
        stableRootHref: bareModuleResolveResult.stableRootUrl.href,
      };
    } else {
      const combinedUri = new URL(uri, fromUri);
      const resolveResult = await this.resolver.resolve(combinedUri);

      let resolvedUri: URL;

      if (!resolveResult.resolvedUrl) {
        resolvedUri = EMPTY_MODULE_URL;
      } else {
        resolvedUri = resolveResult.resolvedUrl;
      }

      const resolvedHref = resolvedUri.href;
      const rootHref = resolveResult.rootUrl.href;

      resolved = {
        type: Bundler.ResolveDetailsKind.Relative,
        ignored: resolveResult.ignored,
        resolvedHref,
        rootHref,
        stableHref: resolvedHref,
        stableRootHref: rootHref,
      };
    }

    return resolved;
  }
}

export namespace Bundler {
  export interface AddOptions {
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
  }

  export interface BundleOptions {
    /**
     * A map of additional dependencies that should be injected into the
     * bundle, but not necessarily invoked.
     */
    dependencies?: Record<string, string>;
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
    token?: CancellationToken;
  }

  export interface Options {
    resolver: Resolver;
  }

  export enum ResolveDetailsKind {
    BareModule = 'bare_module',
    Relative = 'relative',
  }

  export interface BareModuleResolveDetails {
    type: ResolveDetailsKind.BareModule;
    bareModule: {
      isBuiltIn: boolean;
      versionSpec?: string;
      version?: string;
    };
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  interface RelativeResolveDetails {
    type: ResolveDetailsKind.Relative;
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  export type ResolveDetails = BareModuleResolveDetails | RelativeResolveDetails;
}
