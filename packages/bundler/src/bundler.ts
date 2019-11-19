import { CancellationToken, CancellationTokenSource, Resolver } from '@velcro/resolver';
import { Emitter, Event } from 'ts-primitives';

import { isBareModuleSpecifier, Deferred, MapSet } from './util';
import { resolveBareModuleReference } from './bare_modules';
import { Asset } from './asset';
import { InvariantViolation, ResolveError, NotSupportedError } from './error';
import { Bundle } from './bundle';

const EMPTY_MODULE_URL = new URL('velcro://@empty');
const EMPTY_MODULE_CODE = 'module.exports = function(){};';

export class Bundler {
  readonly resolveBareModule: (spec: string, pathname?: string) => URL;
  readonly resolver: Resolver;

  private readonly assetsByHref = new Map<string, Asset>();
  private readonly resolutionCache = new Map<string, Bundler.ResolveDetails>();
  private readonly resolutionInvalidations = new MapSet<string, string>();

  private readonly onAssetAddedEmitter = new Emitter<Asset>();
  private readonly onAssetRemovedEmitter = new Emitter<Asset>();

  static readonly schemaVersion: 1;

  constructor(options: Bundler.Options) {
    this.resolveBareModule = options.resolveBareModule;
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
  }

  private getOrCreateAsset({ resolvedHref: href, rootHref }: Bundler.ResolveDetails): Asset {
    let asset = this.assetsByHref.get(href);

    if (!asset) {
      asset = new Asset(href, rootHref);
      this.assetsByHref.set(href, asset);
      this.onAssetAddedEmitter.fire(asset);
    }

    return asset;
  }

  async generateBundle(entrypoints: string[], options: Bundler.BundleOptions = {}): Promise<Bundle> {
    // console.time('Bundler.generateBundle');
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

    const enqueue = async <T>(op: () => T | Promise<T>): Promise<void> => {
      try {
        pendingOperations++;

        if (options.onEnqueueAsset) {
          options.onEnqueueAsset();
        }

        await op();

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
      } catch (err) {
        // Let's make sure this happens 'later'.
        if (!dfd.isSettled) {
          Promise.resolve()
            .then(() => dfd.reject(err))
            .catch(_ => undefined);
        }
      }
    };

    const resolveHref = async (spec: string, fromHref?: string): Promise<Bundler.ResolveDetails> => {
      const resolutionCacheKey = JSON.stringify([spec, fromHref]);

      let resolveDetails = this.resolutionCache.get(resolutionCacheKey);

      if (!resolveDetails) {
        // console.debug('[MISS] resolveHref(%s, %s)', spec, fromHref);
        resolveDetails = await this.resolveWithDetails(spec, fromHref, { token });

        this.resolutionCache.set(resolutionCacheKey, resolveDetails);

        for (const invalidatedBy of resolveDetails.invalidatedBy) {
          if (invalidatedBy !== resolveDetails.resolvedHref) {
            this.resolutionInvalidations.add(invalidatedBy, resolutionCacheKey);
          }
        }
      } else {
        // console.debug('[HIT] resolveHref(%s, %s)', spec, fromHref);
      }

      return resolveDetails;
    };

    const resolveAsset = async (resolveDetails: Bundler.ResolveDetails): Promise<Asset> => {
      const asset = this.getOrCreateAsset(resolveDetails);

      // Already enqueued in this bundle, no need to re-enqueue
      if (!assets.has(asset)) {
        assets.add(asset);

        if (!asset.magicString || !asset.dependencies) {
          // console.debug('[MISS] resolveAsset(%s)', asset.href);
          const code = await this.readCode(asset, { token });

          asset.setCode(code);
        } else {
          // console.debug('[HIT] resolveAsset(%s)', asset.href);
        }

        for (const dependency of asset.dependencies!) {
          resolveDependency(asset, dependency);
        }
      }

      return asset;
    };

    const resolveDependency = (asset: Asset, dependency: Asset.Dependency) => {
      enqueue(async () => {
        let resolveDetails = dependency.resolveDetails;

        if (!resolveDetails) {
          // console.debug('[MISS] resolveDependency(%s, %s)', asset.href, dependency.value);
          resolveDetails = await resolveHref(dependency.value, asset.href);
          dependency.resolveDetails = resolveDetails;
        } else {
          // console.debug('[HIT] resolveDependency(%s, %s)', asset.href, dependency.value);
        }

        return resolveAsset(resolveDetails);
      });
    };

    if (options.invalidations) {
      for (const invalidation of options.invalidations) {
        for (const resolutionCacheKey of this.resolutionInvalidations.getValues(invalidation)) {
          this.resolutionInvalidations.deleteAll(invalidation);

          if (this.resolutionCache.delete(resolutionCacheKey)) {
            // console.debug('[INVALID] invalidated resolution %s by %s', resolutionCacheKey, invalidation);
          }
        }

        if (this.assetsByHref.delete(invalidation)) {
          // console.debug('[INVALID] invalidated asset %s', invalidation);
        }
      }
    }

    for (const entrypoint of entrypoints) {
      enqueue(async () => {
        // console.time(entrypoint);
        const resolveDetails = await resolveHref(entrypoint);
        const asset = await resolveAsset(resolveDetails);

        entrypointsToAssets.set(entrypoint, asset);

        if (!asset.magicString || !asset.dependencies) {
          // console.debug('[MISS] Code for %s', asset.href);
          const code = await this.readCode(asset, { token });
          const dependencies = asset.setCode(code);

          for (const dependency of dependencies) {
            resolveDependency(asset, dependency);
          }
        }
        // console.timeEnd(entrypoint);
      });
    }

    await dfd.promise;

    // console.timeEnd('Bundler.generateBundle');

    return new Bundle(assets, entrypointsToAssets, dependenciesToAssets);
  }

  private async readCode(asset: Asset, { token }: { token: CancellationToken }): Promise<string> {
    if (asset.href === EMPTY_MODULE_URL.href) {
      return EMPTY_MODULE_CODE;
    }

    const buf = await this.resolver.host.readFileContent(this.resolver, new URL(asset.href), { token });
    const code = this.resolver.decoder.decode(buf);

    return code;
  }

  private async resolveBareModuleReference(
    href: string,
    fromHref: string | undefined,
    { invalidatedBy = new Set(), token }: { invalidatedBy?: Set<string>; token?: CancellationToken } = {}
  ): Promise<Bundler.ResolveDetails> {
    const resolvedArg = await resolveBareModuleReference(this.resolver, href, fromHref, { invalidatedBy, token });

    if (!resolvedArg) {
      // TODO: A good place to inject logic for automatic dependency injection
      throw new ResolveError(href, fromHref);
    }

    switch (resolvedArg.resolvedSpec.type) {
      case 'range':
      case 'tag':
      case 'version':
        const resolvedUri = this.resolveBareModule(
          `${resolvedArg.name}@${resolvedArg.resolvedSpec.fetchSpec}`,
          resolvedArg.pathname
        );

        return this.resolveRelativeModuleReference(resolvedUri.href, fromHref, { invalidatedBy, token });
    }

    throw new NotSupportedError(
      `Unsupported dependency type '${resolvedArg.resolvedSpec.type}' for '${href}'${
        fromHref ? ` from ${fromHref}` : ''
      }`
    );
  }

  private async resolveRelativeModuleReference(
    href: string,
    fromHref: string | undefined,
    { invalidatedBy, token }: { invalidatedBy: Set<string>; token?: CancellationToken }
  ): Promise<Bundler.ResolveDetails> {
    const combinedUri = new URL(href, fromHref);
    const resolveResult = await this.resolver.resolve(combinedUri, { invalidatedBy, token });

    let resolvedUri: URL;

    if (!resolveResult.resolvedUrl) {
      resolvedUri = EMPTY_MODULE_URL;
    } else {
      resolvedUri = resolveResult.resolvedUrl;
    }

    const resolvedHref = resolvedUri.href;
    const rootHref = resolveResult.rootUrl.href;

    return {
      type: Bundler.ResolveDetailsKind.Relative,
      ignored: resolveResult.ignored,
      invalidatedBy,
      resolvedHref,
      rootHref,
      stableHref: resolvedHref,
      stableRootHref: rootHref,
    };
  }

  private async resolveWithDetails(
    uri: string,
    fromUri: string | undefined,
    { invalidatedBy = new Set(), token }: { invalidatedBy?: Set<string>; token?: CancellationToken }
  ): Promise<Bundler.ResolveDetails> {
    if (isBareModuleSpecifier(uri)) {
      return this.resolveBareModuleReference(uri, fromUri, {
        invalidatedBy,
        token,
      });
    }

    return this.resolveRelativeModuleReference(uri, fromUri, { invalidatedBy, token });
  }
}

export namespace Bundler {
  export interface AddOptions {
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
  }

  export interface BundleOptions {
    invalidations?: string[];
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
    token?: CancellationToken;
  }

  export interface Options {
    resolveBareModule: (spec: string, pathname?: string) => URL;
    resolver: Resolver;
  }

  export enum ResolveDetailsKind {
    BareModule = 'bare_module',
    Relative = 'relative',
  }

  export interface ResolveDetails {
    type: ResolveDetailsKind;
    ignored: boolean;
    invalidatedBy: Set<string>;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }
}
