import remapping from '@ampproject/remapping';
import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { CancellationToken, CancellationTokenSource, EntryNotFoundError, Resolver } from '@velcro/resolver';
import { Base64 } from 'js-base64';
import { Bundle } from 'magic-string';
import { Emitter, Event, CanceledError } from 'ts-primitives';

import { isBareModuleSpecifier, Deferred } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { Asset } from './asset';
import { createRuntime } from './runtime';
import { InvariantViolation } from './error';

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

  private getOrCreateAsset(resolveDetails: Bundler.ResolveDetails): Asset {
    let asset = this.assetsByHref.get(resolveDetails.resolvedHref);

    if (!asset) {
      asset = new Asset(resolveDetails.resolvedHref, resolveDetails.rootHref);
      this.assetsByHref.set(resolveDetails.resolvedHref, asset);
      this.onAssetAddedEmitter.fire(asset);
    }

    return asset;
  }

  async generateBundleCode(entrypoints: string[], options: Bundler.BundleOptions = {}): Promise<string> {
    if (!Array.isArray(entrypoints)) {
      throw new Error('Generating a bundle requires passing in an array of entrypoints');
    }
    const tokenSource = new CancellationTokenSource();
    const token = tokenSource.token;

    if (options.token) {
      const disposable = options.token.onCancellationRequested(() => {
        tokenSource.cancel();
        disposable.dispose();
      });
    }

    let pendingOperations = 0;
    const assets = new Set<Asset>();
    const dfd = new Deferred();
    const dependenciesToAliases = new Map<string, Asset>();
    const entrypointsToAssets = new Map<string, Asset>();

    const enqueueUnresolvedAsset = async (spec: string, fromSpec?: string): Promise<Asset> => {
      try {
        pendingOperations++;

        if (options.onEnqueueAsset) {
          options.onEnqueueAsset();
        }

        const resolvedSpec = await this.resolveWithDetails(spec, fromSpec, { token });
        const href = resolvedSpec.resolvedHref;
        const asset = this.getOrCreateAsset(resolvedSpec);

        // No need to re-process the same asset during the same operation
        if (!assets.has(asset)) {
          assets.add(asset);
          if (!asset.magicString) {
            const code = await this.readCode(asset, { token });

            asset.setCode(code);
          }

          const promises = [] as Promise<Asset.Dependency>[];

          for (const dependency of asset.unresolvedDependencies.requireDependencies) {
            promises.push(
              enqueueUnresolvedAsset(dependency.spec.value, href).then(dependencyAsset => {
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
              enqueueUnresolvedAsset(dependency.spec.value, href).then(dependencyAsset => {
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
                enqueueUnresolvedAsset(shim.spec, href).then(dependencyAsset => {
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
        }

        pendingOperations--;

        if (options.onCompleteAsset) {
          options.onCompleteAsset();
        }

        if (pendingOperations < 0) {
          throw new InvariantViolation('Pending operations fell below zero');
        }

        if (pendingOperations === 0) {
          // Let's make sure this happens 'later'.
          Promise.resolve().then(() => dfd.resolve());
        }

        return asset;
      } catch (err) {
        if (options.onCompleteAsset) {
          options.onCompleteAsset();
        }

        // Let's make sure this happens 'later'.
        Promise.resolve().then(() => dfd.reject(err));

        throw err;
      }
    };

    if (options.dependencies) {
      for (const name in options.dependencies) {
        enqueueUnresolvedAsset(`${name}@${options.dependencies[name]}`).then(
          asset => dependenciesToAliases.set(name, asset),
          _ => undefined
        );
      }
    }

    for (const entrypoint of entrypoints) {
      // We need to add a catch handler because we might not catch all thrown exceptions,
      // only the first, via the dfd.promise.
      enqueueUnresolvedAsset(entrypoint).then(asset => entrypointsToAssets.set(entrypoint, asset), _ => undefined);
    }

    await dfd.promise;

    // Now all assets should be fully loaded

    const bundle = new Bundle({ separator: '\n' });

    for (const asset of assets) {
      if (!asset.magicString) {
        throw new Error(`Invariant violation: asset is not loaded '${asset.href}'`);
      }

      const magicString = asset.magicString.clone();

      magicString.trim();

      // We'll replace each dependency string with the resolved stable href. The stable href doesn't require any
      // information about where it is being resolved from, so it is useful as a long-term pointer whose target
      // can change over time
      for (const dependency of asset.dependencies) {
        switch (dependency.type) {
          case Asset.DependencyKind.Require:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.href));
            // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
            break;
          case Asset.DependencyKind.RequireResolve:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.href));
            // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
            break;
          case Asset.DependencyKind.InjectedGlobal:
            magicString.prepend(
              `const ${dependency.symbolName} = require(${JSON.stringify(dependency.href)})${
                dependency.exportName ? `.${dependency.exportName}` : ''
              };\n`
            );
            break;
          default:
            throw new Error(
              `Invariant violation: Encountered unexpected dependency kind '${(dependency as any).type}'`
            );
        }
      }

      magicString.trim();
      magicString.prepend(
        `Velcro.runtime.register(${JSON.stringify(
          asset.href
        )}, function(module, exports, require, __dirname, __filename){\n`
      );

      magicString.append('\n});');

      bundle.addSource(magicString);
    }

    bundle.prepend(
      `(${createRuntime.toString()})(typeof globalThis === 'object' ? (globalThis.Velcro || (globalThis.Velcro = {})) : (this.Velcro || (this.Velcro = {})));\n`
    );

    for (const [name, asset] of dependenciesToAliases) {
      bundle.append(`Velcro.runtime.alias(${JSON.stringify(name)}, ${JSON.stringify(asset.href)});\n`);
    }

    if (options.requireEntrypoints) {
      for (const asset of entrypointsToAssets.values()) {
        bundle.append(`Velcro.runtime.require(${JSON.stringify(asset.href)});\n`);
      }
    }

    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));

    if (token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const bundleCode = bundle.toString();

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMap = bundle.generateMap({
        includeContent: true,
        hires: false,
      });

      sourceMap.file = `velcro://bundle.js`;

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));

      if (token.isCancellationRequested) {
        throw new CanceledError('Canceled');
      }

      // In case a source map seems to be self-referential, avoid crashing
      const seen = new Set<Asset>();
      const combinedMap = remapping(
        sourceMap.toString(),
        (uri: string) => {
          const asset = this.assetsByHref.get(uri);

          if (asset && asset.sourceMappingUrl) {
            if (seen.has(asset)) {
              return null;
            }

            seen.add(asset);

            const match = asset.sourceMappingUrl.match(/^data:application\/json;(?:charset=([^;]+);)?base64,(.*)$/);

            if (match) {
              if (match[1] && match[1] !== 'utf-8') {
                return null;
              }

              try {
                const decoded = JSON.parse(Base64.decode(match[2]));

                return decoded;
              } catch (err) {
                return null;
              }
            }
          }

          return null;
        },
        false
      );

      sourceMapSuffix = `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Base64.encode(
        JSON.stringify(combinedMap)
      )}`;
    }

    return `${bundleCode}${sourceMapSuffix}`;
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
    { token }: { token: CancellationToken }
  ): Promise<Bundler.ResolveDetails> {
    let resolved: Bundler.ResolveDetails;

    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri, { token });

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
    requireEntrypoints?: boolean;
    sourceMap?: boolean;
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
