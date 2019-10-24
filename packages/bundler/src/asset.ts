import MagicString from 'magic-string';
import { getSourceMappingUrl } from './util';
import { UnresolvedDependencies, parseFile } from './parser';

export class Asset {
  readonly dependencies = [] as Asset.Dependency[];
  readonly unresolvedDependencies = {} as UnresolvedDependencies;

  readonly deps = new Map<Asset.Dependency, Asset>();

  magicString?: MagicString;
  sourceMappingUrl?: string;

  constructor(readonly href: string, readonly rootHref: string) {}

  setCode(code: string) {
    this.magicString = new MagicString(code, {
      filename: this.href,
      indentExclusionRanges: [],
    });
    this.sourceMappingUrl = getSourceMappingUrl(code);

    const parser = getParserForAsset(this);
    const dependencies = parser.parse(this.href, this.magicString);

    this.unresolvedDependencies.requireDependencies = dependencies.requireDependencies;
    this.unresolvedDependencies.requireResolveDependencies = dependencies.requireResolveDependencies;
    this.unresolvedDependencies.unboundSymbols = dependencies.unboundSymbols;
  }

  toJSON() {
    return {
      href: this.href,
      rootHref: this.rootHref,
      dependencies: this.dependencies,
      sourceMappingUrl: this.sourceMappingUrl,
      code: this.magicString ? this.magicString.original : '',
    };
  }

  static fromJSON(json: Asset.AsObject): Asset {
    const asset = new Asset(json.href, json.rootHref);

    asset.dependencies.push(...json.dependencies);
    asset.sourceMappingUrl = json.sourceMappingUrl;
    asset.setCode(json.code);

    return asset;
  }
}

export namespace Asset {
  export type AsObject = ReturnType<Asset['toJSON']>;

  export enum DependencyKind {
    Require = 'require',
    RequireResolve = 'require.resolve',
    InjectedGlobal = 'injected_global',
  }

  export interface RequireDependency {
    type: DependencyKind.Require;
    href: string;
    rootHref: string;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
    value: string;
  }

  export interface RequireResolveDependency {
    type: DependencyKind.RequireResolve;
    href: string;
    rootHref: string;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
    value: string;
  }

  export interface InjectedGlobalDependency {
    type: DependencyKind.InjectedGlobal;
    href: string;
    rootHref: string;
    exportName?: string;
    references: { start: number; end: number }[];
    symbolName: string;
    value: string;
  }

  export type Dependency = RequireDependency | RequireResolveDependency | InjectedGlobalDependency;
}

function getParserForAsset(asset: Asset): { parse: typeof parseFile } {
  if (asset.href.endsWith('.json')) {
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
