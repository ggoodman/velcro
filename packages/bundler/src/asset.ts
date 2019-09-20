import MagicString from 'magic-string';

export class Asset {
  readonly dependencies = [] as Asset.Dependency[];
  readonly roots = new Set<string>();

  magicString?: MagicString;
  sourceMappingUrl?: string;

  constructor(readonly href: string, readonly rootHref: string) {}
}

export namespace Asset {
  export enum DependencyKind {
    Require = 'require',
    RequireResolve = 'require.resolve',
    InjectedGlobal = 'injected_global',
  }

  export interface RequireDependency {
    type: DependencyKind.Require;
    asset: Asset;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
  }

  export interface RequireResolveDependency {
    type: DependencyKind.RequireResolve;
    asset: Asset;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
  }

  export interface InjectedGlobalDependency {
    type: DependencyKind.InjectedGlobal;
    asset: Asset;
    exportName?: string;
    references: { start: number; end: number }[];
    symbolName: string;
  }

  export type Dependency = RequireDependency | RequireResolveDependency | InjectedGlobalDependency;
}
