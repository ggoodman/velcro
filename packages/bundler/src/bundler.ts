import remapping from '@ampproject/remapping';
import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { Resolver } from '@velcro/resolver';
import { Base64 } from 'js-base64';
import { Bundle } from 'magic-string';

import { isBareModuleSpecifier } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { parseFile } from './parser';
import { Asset } from './asset';
import { createRuntime } from './runtime';
import { Queue } from './queue';

const CACHE_KEY_SEPARATOR = '|';

const EMPTY_MODULE_HREF = new URL('velcro://@empty');
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
  private readonly aliases = new Map<string, string>();
  private readonly assetsByHref = new Map<string, Asset>();
  private readonly aliasDependencies = new Map<string, Set<Asset>>();
  private readonly cache?: Bundler.Cache;
  private readonly pendingAdds = new Map<string, Promise<Asset>>();
  private readonly pendingResolves = new Map<string, Promise<Asset>>();
  private readonly resolver: Resolver;

  static readonly schemaVersion: 1;

  constructor(options: Bundler.Options) {
    this.cache = options.cache;
    this.resolver = options.resolver;
  }

  /**
   * Add an asset and its dependency tree to the bundle
   *
   * @param spec A resolvable asset that should be added
   */
  async add(spec: string, options: Bundler.AddOptions = {}): Promise<Asset | undefined> {
    const queue = new Queue(options.onEnqueueAsset, options.onCompleteAsset);
    const asset = await this.addUnresolved(queue, spec);

    try {
      this.aliases.set(spec, asset.href);

      await queue.wait();
    } finally {
      this.aliasDependencies.set(spec, new Set([asset, ...queue.assets]));
    }

    return asset;
  }

  generateBundleCode(options: { entrypoint?: string; sourceMap?: boolean } = {}): string {
    if (this.pendingAdds.size || this.pendingResolves.size) {
      throw new Error(`Unable to generate bundle code while assets are being loaded`);
    }

    if (options.entrypoint && !this.aliases.has(options.entrypoint)) {
      throw new Error(`Unable to generate bundle with an unknown entrypoint ${options.entrypoint}`);
    }

    const bundle = new Bundle({ separator: '\n' });

    for (const [aliasFrom, aliasTo] of this.aliases) {
      bundle.append(`Velcro.runtime.alias(${JSON.stringify(aliasFrom)}, ${JSON.stringify(aliasTo)});\n`);
    }

    for (const [, asset] of this.assetsByHref) {
      if (!asset.magicString) {
        throw new Error(`Invariant violation: asset is not loaded ${asset.href}`);
      }

      const magicString = asset.magicString.clone();

      magicString.trim();

      // We'll replace each dependency string with the resolved stable href. The stable href doesn't require any
      // information about where it is being resolved from, so it is useful as a long-term pointer whose target
      // can change over time
      for (const dependency of asset.dependencies) {
        switch (dependency.type) {
          case Asset.DependencyKind.Require:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.asset.href));
            // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
            break;
          case Asset.DependencyKind.RequireResolve:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.asset.href));
            // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
            break;
          case Asset.DependencyKind.InjectedGlobal:
            magicString.prepend(
              `const ${dependency.symbolName} = require(${JSON.stringify(dependency.asset.href)})${
                dependency.exportName ? `.${dependency.exportName}` : ''
              };\n`
            );
            break;
          default:
            throw new Error(`Invariant violation: Encountered unexpected dependency kind ${(dependency as any).type}`);
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

    if (options.entrypoint) {
      bundle.append(`Velcro.runtime.require(${JSON.stringify(options.entrypoint)});\n`);
    }

    const bundleCode = bundle.toString();

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMap = bundle.generateMap({
        includeContent: false,
        hires: false,
      });

      sourceMap.file = `velcro://${options.entrypoint || 'root'}`;

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

      sourceMapSuffix = `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa(
        JSON.stringify(combinedMap)
      )}`;
    }

    return `${bundleCode}${sourceMapSuffix}`;
  }

  async remove(href: string): Promise<boolean> {
    const aliasDependencies = this.aliasDependencies.get(href);

    if (!aliasDependencies) {
      return false;
    }

    const alias = this.aliases.get(href);

    this.aliasDependencies.delete(href);
    this.aliases.delete(href);

    dependency: for (const dependency of aliasDependencies) {
      for (const otherDependencies of this.aliasDependencies.values()) {
        if (otherDependencies.has(dependency)) {
          continue dependency;
        }
      }

      this.assetsByHref.delete(dependency.href);
    }

    if (this.cache && alias) {
      await this.cache.delete({
        id: alias,
        schemaVersion: Bundler.schemaVersion,
        segment: Bundler.CacheSegmentKind.Asset,
      });
    }

    return true;
  }

  private async addUnresolved(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveKey = `${href}${CACHE_KEY_SEPARATOR}${fromHref}`;

    let pendingResolve = this.pendingResolves.get(resolveKey);

    if (!pendingResolve) {
      pendingResolve = this.addResolving(queue, href, fromHref);
      this.pendingResolves.set(resolveKey, pendingResolve);
    }

    try {
      return await pendingResolve;
    } finally {
      this.pendingResolves.delete(resolveKey);
    }
  }

  private async addResolving(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveResult = await this.resolveWithDetails(href, fromHref);

    return this.addResolved(queue, resolveResult.resolvedHref, resolveResult.rootHref, resolveResult.cacheable);
  }

  private async addResolved(queue: Queue, href: string, rootHref: string, cacheable: boolean): Promise<Asset> {
    const cacheRecord: Bundler.CacheRecord<Bundler.CacheSegmentKind.Asset> = {
      id: href,
      schemaVersion: Bundler.schemaVersion,
      segment: Bundler.CacheSegmentKind.Asset,
    };
    const dependencyPromises = [] as Promise<Asset>[];

    let asset = this.assetsByHref.get(href);
    let cached = false;

    if (!asset) {
      if (this.cache) {
        const cachedAsset = await this.cache.get(cacheRecord);

        if (cachedAsset) {
          asset = Asset.fromJSON(cachedAsset);
          cached = true;

          this.assetsByHref.set(href, asset);

          for (const dependency of asset.dependencies) {
            const promise = this.addResolved(queue, dependency.asset.href, dependency.asset.rootHref, true);

            queue.add(promise);
          }
        }
      }
    }

    if (!asset) {
      asset = new Asset(href, rootHref);
      this.assetsByHref.set(href, asset);

      const code = await this.readCode(href);

      asset.setCode(code);

      const parser = getParserForFile(href);
      const parsedFile = parser.parse(href, asset.magicString!);

      for (const dependency of parsedFile.requireDependencies) {
        dependencyPromises.push(
          (async () => {
            const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, href);

            asset!.dependencies.push({
              type: Asset.DependencyKind.Require,
              asset: dependencyAsset,
              callee: dependency.callee,
              spec: dependency.spec,
            });

            return dependencyAsset;
          })()
        );
      }

      for (const dependency of parsedFile.requireResolveDependencies) {
        dependencyPromises.push(
          (async () => {
            const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, href);

            asset!.dependencies.push({
              type: Asset.DependencyKind.RequireResolve,
              asset: dependencyAsset,
              callee: dependency.callee,
              spec: dependency.spec,
            });

            return dependencyAsset;
          })()
        );
      }

      for (const [symbolName, references] of parsedFile.unboundSymbols) {
        const shim = DEFAULT_SHIM_GLOBALS[symbolName];

        if (shim) {
          dependencyPromises.push(
            (async () => {
              const dependencyAsset = await this.addUnresolved(queue, shim.spec, href);

              asset!.dependencies.push({
                type: Asset.DependencyKind.InjectedGlobal,
                asset: dependencyAsset,
                references,
                exportName: shim.export,
                symbolName,
              });

              return dependencyAsset;
            })()
          );
        }
      }

      queue.add(...dependencyPromises);
    }

    if (this.cache && cacheable && !cached) {
      const dependenciesReadyPromise: Promise<unknown> = dependencyPromises.length
        ? Promise.all(dependencyPromises)
        : Promise.resolve();

      dependenciesReadyPromise.then(() => {
        this.cache!.set(cacheRecord, asset!.toJSON()).catch(err => {
          console.error({ cacheRecord, err }, 'Failed storing cache record');
        });
      });
    }

    return asset;
  }

  private async readCode(uri: string): Promise<string> {
    if (uri === EMPTY_MODULE_HREF.href) {
      return EMPTY_MODULE_CODE;
    }

    const buf = await this.resolver.host.readFileContent(this.resolver, new URL(uri));
    const code = this.resolver.decoder.decode(buf);

    return code;
  }

  private async resolveWithDetails(uri: string, fromUri?: string): Promise<Bundler.ResolveDetails> {
    const id = `${uri}${CACHE_KEY_SEPARATOR}${fromUri}`;
    const cacheRecord: Bundler.CacheRecord<Bundler.CacheSegmentKind.Resolve> = {
      id,
      schemaVersion: Bundler.schemaVersion,
      segment: Bundler.CacheSegmentKind.Resolve,
    } as const;

    if (this.cache) {
      const cached = await this.cache.get(cacheRecord);

      if (cached) {
        return cached;
      }
    }

    let resolved: Bundler.ResolveDetails;

    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri);

      if (!bareModuleResolveResult.stableUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable url`);
      }

      if (!bareModuleResolveResult.stableRootUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable root url`);
      }

      const resolvedHref = bareModuleResolveResult.resolvedUrl
        ? bareModuleResolveResult.resolvedUrl.href
        : EMPTY_MODULE_HREF.href;

      resolved = {
        type: Bundler.ResolveDetailsKind.BareModule,
        bareModule: {
          isBuiltIn: bareModuleResolveResult.bareModule.isBuiltIn,
          version: bareModuleResolveResult.bareModule.version,
          versionSpec: bareModuleResolveResult.bareModule.versionSpec,
        },
        cacheable: bareModuleResolveResult.cacheable,
        ignored: bareModuleResolveResult.ignored,
        resolvedHref,
        rootHref: bareModuleResolveResult.rootUrl.href,
        stableHref: bareModuleResolveResult.stableUrl.href,
        stableRootHref: bareModuleResolveResult.stableRootUrl.href,
      };
    } else {
      const combinedUri = new URL(uri, fromUri);
      const resolveResult = await this.resolver.resolveWithDetails(combinedUri);

      let resolvedUri: URL;

      if (!resolveResult.resolvedUrl) {
        resolvedUri = EMPTY_MODULE_HREF;
      } else {
        resolvedUri = resolveResult.resolvedUrl;
      }

      const resolvedHref = resolvedUri.href;
      const rootHref = resolveResult.rootUrl.href;

      resolved = {
        type: Bundler.ResolveDetailsKind.Relative,
        cacheable: resolveResult.cacheable,
        ignored: resolveResult.ignored,
        resolvedHref,
        rootHref,
        stableHref: resolvedHref,
        stableRootHref: rootHref,
      };
    }

    if (this.cache && resolved.cacheable) {
      this.cache.set(cacheRecord, resolved).catch(err => {
        console.error({ cacheRecord, err }, 'Failed storing cache record');
      });
    }

    return resolved;
  }
}

export namespace Bundler {
  export interface AddOptions {
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
  }

  export interface Cache {
    delete(record: CacheRecord<CacheSegmentKind>): Promise<void>;

    get(record: CacheRecord<CacheSegmentKind.Asset>): Promise<Asset.AsObject | undefined>;
    set(record: CacheRecord<CacheSegmentKind.Asset>, resolveDetails: Asset.AsObject): Promise<void>;

    get(record: CacheRecord<CacheSegmentKind.Resolve>): Promise<ResolveDetails | undefined>;
    set(record: CacheRecord<CacheSegmentKind.Resolve>, resolveDetails: ResolveDetails): Promise<void>;
  }

  export interface CacheRecord<TSegment extends CacheSegment = CacheSegment> {
    id: string;
    /** The version (or generation) of the cache */
    schemaVersion: number;
    /** The cache should support storage and retrieval of different segments */
    segment: TSegment;
  }

  export enum CacheSegmentKind {
    Asset = 'asset',
    Resolve = 'resolve',
  }

  export type CacheSegment = CacheSegmentKind.Asset | CacheSegmentKind.Resolve;

  export interface Options {
    cache?: Cache;
    resolver: Resolver;
  }

  export enum ResolveDetailsKind {
    BareModule = 'bare_module',
    Relative = 'relative',
  }

  interface BareModuleResolveDetails {
    type: ResolveDetailsKind.BareModule;
    bareModule: {
      isBuiltIn: boolean;
      versionSpec?: string;
      version?: string;
    };
    cacheable: boolean;
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  interface RelativeResolveDetails {
    type: ResolveDetailsKind.Relative;
    cacheable: boolean;
    ignored: boolean;
    resolvedHref: string;
    rootHref: string;
    stableHref: string;
    stableRootHref: string;
  }

  export type ResolveDetails = BareModuleResolveDetails | RelativeResolveDetails;
}

function getParserForFile(uri: string): { parse: typeof parseFile } {
  if (uri.endsWith('.json')) {
    return {
      parse: (_uri, magicString): ReturnType<typeof parseFile> => {
        magicString.prepend('module.exports = ');

        return {
          requireDependencies: [],
          requireResolveDependencies: [],
          unboundSymbols: new Map(),
        };
      },
    };
  }

  return {
    parse: parseFile,
  };
}
