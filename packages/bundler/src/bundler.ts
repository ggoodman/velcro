import remapping from '@ampproject/remapping';
import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { EntryNotFoundError, Resolver } from '@velcro/resolver';
import { Base64 } from 'js-base64';
import { Bundle } from '@velcro/magic-string';
import { Emitter } from 'ts-primitives';

import { isBareModuleSpecifier } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { parseFile } from './parser';
import { Asset } from './asset';
import { createRuntime } from './runtime';
import { Queue } from './queue';
import { ResolveError } from './error';

const RESOLVE_KEY_SEPARATOR = '|';

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
  private readonly assetsByHref = new Map<string, Asset>();
  private readonly assetsByRootHref = new Map<string, Set<Asset>>();
  private readonly pendingResolves = new Map<string, Promise<Asset>>();
  private readonly resolver: Resolver;

  private readonly onAssetAddedEmitter = new Emitter<Asset>();
  private readonly onAssetRemovedEmitter = new Emitter<Asset>();

  static readonly schemaVersion: 1;

  constructor(options: Bundler.Options) {
    this.resolver = options.resolver;
  }

  get onAssetAdded() {
    return this.onAssetAddedEmitter.event;
  }

  get onAssetRemoved() {
    return this.onAssetRemovedEmitter.event;
  }

  async generateBundleCode(entrypoints: string[], options: Bundler.BundleOptions = {}): Promise<string> {
    if (!Array.isArray(entrypoints) || !entrypoints.length) {
      throw new Error('Generating a bundle requires passing in an array of entrypoints');
    }
    const queue = new Queue(options.onEnqueueAsset, options.onCompleteAsset);
    const addedAssets = await Promise.all(entrypoints.map(entrypoint => this.addUnresolved(queue, entrypoint)));
    const entrypointsToAssets = {} as Record<string, Asset>;

    for (const idx in entrypoints) {
      entrypointsToAssets[entrypoints[idx]] = addedAssets[idx];
    }

    await queue.wait();

    const assetsToInclude = [...addedAssets];
    const includedAssets = new Set() as Set<Asset>;
    const bundle = new Bundle({ separator: '\n' });

    while (assetsToInclude.length) {
      const asset = assetsToInclude.shift()!;

      if (includedAssets.has(asset)) {
        continue;
      }
      includedAssets.add(asset);

      for (const dependency of asset.dependencies) {
        switch (dependency.type) {
          case Asset.DependencyKind.InjectedGlobal:
          case Asset.DependencyKind.Require:
            const asset = this.assetsByHref.get(dependency.href);

            if (!asset) {
              throw new Error(`Invariant violation: Asset not loaded for '${dependency.href}'`);
            }

            assetsToInclude.push(asset);
            continue;
          case Asset.DependencyKind.RequireResolve:
            // Nothing really to do for this
            continue;
          default:
            throw new Error(`Invariant violation: Unknown dependency type '${(dependency as any).type}'`);
        }
      }

      if (!asset.magicString) {
        throw new Error(`Invariant violation: asset is not loaded '${asset.href}'`);
      }

      const magicString = asset.magicString.clone();

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

    if (options.requireEntrypoints) {
      for (const entrypoint in entrypointsToAssets) {
        const asset = entrypointsToAssets[entrypoint];

        bundle.append(`Velcro.runtime.require(${JSON.stringify(asset.href)});\n`);
      }
    }

    const bundleCode = bundle.toString();

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMap = bundle.generateMap({
        includeContent: options.includeSourceContent,
        hires: false,
      });

      sourceMap.file = `velcro://bundle.js`;

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

  async invalidate(spec: string): Promise<boolean> {
    let asset = this.assetsByHref.get(spec);

    if (!asset) {
      // We can't use Bundler::resolveWithDetails() because that will throw
      // when a module isn't found. We just want to attempt to resolve and
      // return true / false accordingly.
      let resolveResult: { resolvedUrl?: URL } | undefined = undefined;

      try {
        if (isBareModuleSpecifier(spec)) {
          resolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, spec);
        } else {
          const combinedUri = new URL(spec);
          resolveResult = await this.resolver.resolveWithDetails(combinedUri);
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

  private addAsset(asset: Asset): void {
    const hadAsset = this.assetsByHref.has(asset.href);

    this.assetsByHref.set(asset.href, asset);

    let assetsByRootHref = this.assetsByRootHref.get(asset.rootHref);

    if (!assetsByRootHref) {
      assetsByRootHref = new Set();
      this.assetsByRootHref.set(asset.rootHref, assetsByRootHref);
    }

    assetsByRootHref.add(asset);

    if (!hadAsset) {
      this.onAssetAddedEmitter.fire(asset);
    }
  }

  private removeAsset(asset: Asset): void {
    const hadAsset = this.assetsByHref.delete(asset.href);

    const assetsByRootHref = this.assetsByRootHref.get(asset.rootHref);

    if (assetsByRootHref) {
      assetsByRootHref.delete(asset);
    }

    if (hadAsset) {
      this.onAssetRemovedEmitter.fire(asset);
    }
  }

  private async addUnresolved(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveKey = `${href}${RESOLVE_KEY_SEPARATOR}${fromHref}`;

    let pendingResolve = this.pendingResolves.get(resolveKey);

    if (!pendingResolve) {
      pendingResolve = this.addResolving(queue, href, fromHref);
      this.pendingResolves.set(resolveKey, pendingResolve);
    }

    try {
      return await pendingResolve;
    } catch (err) {
      if (err instanceof EntryNotFoundError) {
        throw new ResolveError(href, fromHref);
      }

      throw err;
    } finally {
      this.pendingResolves.delete(resolveKey);
    }
  }

  private async addResolving(queue: Queue, href: string, fromHref?: string): Promise<Asset> {
    const resolveResult = await this.resolveWithDetails(href, fromHref);

    return this.addResolved(queue, resolveResult.resolvedHref, resolveResult.rootHref);
  }

  private async addResolved(queue: Queue, href: string, rootHref: string): Promise<Asset> {
    let asset = this.assetsByHref.get(href);

    if (!asset) {
      asset = new Asset(href, rootHref);

      this.addAsset(asset);

      try {
        const code = await this.readCode(href);

        asset.setCode(code);
      } catch (err) {
        this.removeAsset(asset);

        throw err;
      }

      const parser = getParserForFile(href);
      const parsedFile = parser.parse(href, asset.magicString!);

      for (const dependency of parsedFile.requireDependencies) {
        queue.add(async () => {
          const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, href);
          asset!.dependencies.push({
            type: Asset.DependencyKind.Require,
            href: dependencyAsset.href,
            rootHref: dependencyAsset.rootHref,
            callee: dependency.callee,
            spec: dependency.spec,
            value: dependency.spec.value,
          });

          return dependencyAsset;
        });
      }

      for (const dependency of parsedFile.requireResolveDependencies) {
        queue.add(async () => {
          const dependencyAsset = await this.addUnresolved(queue, dependency.spec.value, href);

          asset!.dependencies.push({
            type: Asset.DependencyKind.RequireResolve,
            href: dependencyAsset.href,
            rootHref: dependencyAsset.rootHref,
            callee: dependency.callee,
            spec: dependency.spec,
            value: dependency.spec.value,
          });

          return dependencyAsset;
        });
      }

      for (const [symbolName, references] of parsedFile.unboundSymbols) {
        const shim = DEFAULT_SHIM_GLOBALS[symbolName];

        if (shim) {
          queue.add(async () => {
            const dependencyAsset = await this.addUnresolved(queue, shim.spec, href);

            asset!.dependencies.push({
              type: Asset.DependencyKind.InjectedGlobal,
              href: dependencyAsset.href,
              rootHref: dependencyAsset.rootHref,
              references,
              exportName: shim.export,
              symbolName,
              value: `${shim.spec}${shim.export ? `[${JSON.stringify(shim.export)}]` : ''}`,
            });

            return dependencyAsset;
          });
        }
      }
    } else {
      const existingAsset = asset;
      // We already have an asset instance, let's make sure dependencies are OK
      for (const dependency of existingAsset.dependencies) {
        if (!this.assetsByHref.has(dependency.href)) {
          queue.add(async () => this.addUnresolved(queue, dependency.value, existingAsset.href));
        }
      }
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
    let resolved: Bundler.ResolveDetails;

    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri);

      if (!bareModuleResolveResult.stableUrl) {
        throw new Error(`Failed to resolve bare module '${uri}' from '${fromUri || '@root'}' to a stable url`);
      }

      if (!bareModuleResolveResult.stableRootUrl) {
        throw new Error(`Failed to resolve bare module '${uri}' from '${fromUri || '@root'}' to a stable root url`);
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
    includeSourceContent?: boolean | ((source: { filename: string | null; content: string }) => boolean);
    onEnqueueAsset?(): void;
    onCompleteAsset?(): void;
    requireEntrypoints?: boolean;
    sourceMap?: boolean;
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

function getParserForFile(uri: string): { parse: typeof parseFile } {
  if (uri.endsWith('.css')) {
    return {
      parse: (_uri, magicString): ReturnType<typeof parseFile> => {
        const cssCode = magicString.original;
        const BACKSLASH = '\\'.charCodeAt(0);
        const SINGLE_QUOTE = "'".charCodeAt(0);
        const NL = '\n'.charCodeAt(0);
        const CR = '\r'.charCodeAt(0);

        let escaped = false;

        for (let i = 0; i < cssCode.length; i++) {
          const char = cssCode.charCodeAt(i);

          if (char === BACKSLASH) {
            escaped = !escaped;
            continue;
          }

          if (!escaped) {
            // Escape certain characters (if not already escaped)
            switch (char) {
              case CR:
              case NL:
              case SINGLE_QUOTE:
                magicString.prependRight(i, '\\');
                break;
            }
          }

          escaped = false;
        }

        magicString.prepend(
          'var styleTag = document.createElement("style");styleTag.type = "text/css";styleTag.innerHTML = \''
        );
        magicString.append('\';document.getElementsByTagName("head")[0].appendChild(styleTag);');

        var styleTag = document.createElement('style');
        styleTag.textContent;

        return {
          requireDependencies: [],
          requireResolveDependencies: [],
          unboundSymbols: new Map(),
        };
      },
    };
  }

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
