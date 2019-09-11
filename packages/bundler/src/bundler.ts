import { Resolver } from '@velcro/resolver';

import { isBareModuleSpecifier, Deferred } from './util';
import { resolveBareModuleToUnpkgWithDetails } from './unpkg';
import { parseFile } from './parser';
import { Asset } from './asset';
import { AssetGroup } from './asset_group';
import MagicString from 'magic-string';

const EMPTY_MODULE_HREF = new URL('velcro://@empty');
const EMPTY_MODULE_CODE = 'module.exports = {};';

export class Bundler {
  public readonly assetsByHref = new Map<string, Asset>();
  public readonly assetGroups = new Map<string, AssetGroup>();
  public readonly resolver: Resolver;

  private readonly assetPromisesByHref = new Map<string, Promise<Asset>>();

  constructor(options: Bundler.Options) {
    this.resolver = options.resolver;
  }

  /**
   * Add an asset and its dependency tree to the bundle
   *
   * @param spec A resolvable asset that should be added
   */
  async add(spec: string): Promise<Asset> {
    const resolvedSpec = await this.resolveWithDetails(spec);
    const dfd = new Deferred<Asset>();

    let pending = 0;

    const addOne = (
      uri: string,
      fromUri?: string
    ): Promise<{ asset: Asset; stableHref: string; stableRootHref: string }> => {
      pending++;
      const start = Date.now();
      const added = this.resolveWithDetails(uri, fromUri).then(async resolveResult => {
        const asset = this.assetsByHref.get(resolveResult.resolvedHref);
        const stableHref = resolveResult.stableHref;
        const stableRootHref = resolveResult.stableRootHref;

        if (asset) {
          return { asset, stableHref, stableRootHref };
        }

        let assetPromise = this.assetPromisesByHref.get(resolveResult.resolvedHref);

        if (!assetPromise) {
          assetPromise = (async (): Promise<Asset> => {
            const code = await this.readCode(resolveResult.resolvedHref);
            const magicString = new MagicString(code, {
              filename: resolveResult.resolvedHref,
              indentExclusionRanges: [],
            });
            const parser = getParserForFile(resolveResult.resolvedHref);
            const parsedFile = parser.parse(resolveResult.resolvedHref, magicString);
            const dependencies: Asset.ResolvedDependency[] = await Promise.all(
              [...parsedFile.dependencies].map(dependency =>
                addOne(dependency.spec.value, resolveResult.resolvedHref).then(
                  ({ asset, stableHref, stableRootHref }) => {
                    return {
                      type: dependency.type,
                      asset,
                      spec: dependency.spec,
                      stableHref,
                      stableRootHref,
                      callee: dependency.callee,
                    };
                  }
                )
              )
            );
            const asset = new Asset(
              resolveResult.resolvedHref,
              resolveResult.rootHref,
              magicString,
              dependencies,
              parsedFile.unboundSymbols
            );

            this.addAsset(asset);

            console.log('added', pending, Date.now() - start, asset.href, asset.dependencies.length);
            return asset;
          })();

          this.assetPromisesByHref.set(resolveResult.resolvedHref, assetPromise);
        }

        return { asset: await assetPromise, stableHref, stableRootHref };
      });

      added.then(
        ({ asset }) => {
          pending--;
          if (pending <= 0) {
            dfd.resolve(asset);
          }
        },
        err => {
          dfd.reject(err);
        }
      );

      return added;
    };

    addOne(resolvedSpec.resolvedHref);

    return dfd.promise;
  }

  private addAsset(asset: Asset) {
    this.assetsByHref.set(asset.href, asset);
    this.assetPromisesByHref.delete(asset.href);

    let assetGroup = this.assetGroups.get(asset.rootHref);

    if (!assetGroup) {
      assetGroup = new AssetGroup(asset.rootHref);
      this.assetGroups.set(assetGroup.baseHref, assetGroup);
    }

    assetGroup.add(asset);
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
    if (isBareModuleSpecifier(uri)) {
      const bareModuleResolveResult = await resolveBareModuleToUnpkgWithDetails(this.resolver, uri, fromUri);

      if (!bareModuleResolveResult.resolvedUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'}`);
      }

      if (!bareModuleResolveResult.stableUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable url`);
      }

      if (!bareModuleResolveResult.stableRootUrl) {
        throw new Error(`Failed to resolve bare module ${uri} from ${fromUri || '@root'} to a stable root url`);
      }

      return {
        type: Bundler.ResolveDetailsKind.BareModule,
        bareModule: {
          isBuiltIn: bareModuleResolveResult.bareModule.isBuiltIn,
          version: bareModuleResolveResult.bareModule.version,
          versionSpec: bareModuleResolveResult.bareModule.versionSpec,
        },
        ignored: bareModuleResolveResult.ignored,
        resolvedHref: bareModuleResolveResult.resolvedUrl.href,
        rootHref: bareModuleResolveResult.rootUrl.href,
        stableHref: bareModuleResolveResult.stableUrl.href,
        stableRootHref: bareModuleResolveResult.stableRootUrl.href,
      };
    }

    const combinedUri = new URL(uri, fromUri);
    const resolveResult = await this.resolver.resolveWithDetails(combinedUri);

    let resolvedUri: URL;

    if (resolveResult.resolvedUrl === undefined) {
      throw new Error(`Failed to resolve ${uri} from ${fromUri || '@root'}`);
    }

    if (resolveResult.ignored) {
      resolvedUri = EMPTY_MODULE_HREF;
    } else {
      resolvedUri = resolveResult.resolvedUrl as URL;
    }

    const resolvedHref = resolvedUri.href;
    const rootHref = resolveResult.rootUrl.href;

    return {
      type: Bundler.ResolveDetailsKind.Relative,
      ignored: resolveResult.ignored,
      resolvedHref,
      rootHref,
      stableHref: resolvedHref,
      stableRootHref: rootHref,
    };
  }
}

export namespace Bundler {
  export interface Options {
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

function getParserForFile(uri: string) {
  if (uri.endsWith('.json')) {
    return {
      parse: () => ({ dependencies: [], unboundSymbols: new Map() } as ReturnType<typeof parseFile>),
    };
  }

  return {
    parse: parseFile,
  };
}
