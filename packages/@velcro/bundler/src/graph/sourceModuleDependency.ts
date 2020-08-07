import type { Uri } from '@velcro/common';

export enum SourceModuleDependencyKind {
  Entrypoint = 'Entrypoint',
  Require = 'Require',
  RequireResolve = 'RequireResolve',
  GlobalObject = 'GlobalObject',
}

interface SourceModuleOptions {
  exportName?: string;
}

type SourceLocation = { start: number; end: number };

export class SourceModuleDependency {
  locator?: { name: string; spec: string; path: string; version?: string };

  constructor(
    readonly kind: SourceModuleDependencyKind,
    readonly spec: string,
    readonly locations: ReadonlyArray<SourceLocation>,
    readonly options: SourceModuleOptions = {}
  ) {}

  static areIdentical(l: SourceModuleDependency, r: SourceModuleDependency) {
    return l.kind === r.kind && l.spec === r.spec;
  }

  static fromEntrypoint(uri: Uri) {
    return new SourceModuleDependency(SourceModuleDependencyKind.Entrypoint, uri.toString(), []);
  }

  static fromGlobalObject(spec: string, locations: SourceLocation[], exportName?: string) {
    return new SourceModuleDependency(SourceModuleDependencyKind.GlobalObject, spec, locations, {
      exportName,
    });
  }

  static fromRequire(spec: string, locations: SourceLocation[]) {
    return new SourceModuleDependency(SourceModuleDependencyKind.Require, spec, locations);
  }

  static fromRequireResolve(spec: string, locations: SourceLocation[]) {
    return new SourceModuleDependency(SourceModuleDependencyKind.RequireResolve, spec, locations);
  }
}
