import MagicString from 'magic-string';

import { NodeWithStartAndEnd } from './ast';

export class Asset {
  constructor(
    public readonly href: string,
    public readonly rootHref: string,
    public readonly magicString: MagicString,
    public readonly dependencies: Asset.ResolvedDependency[],
    public readonly unboundSymbols: Map<string, NodeWithStartAndEnd[]>
  ) {}

  generateCode(options: { sourceMap?: boolean } = {}): string {
    const magicString = this.magicString.clone();

    for (const dependency of this.dependencies) {
      switch (dependency.type) {
        case Asset.DependencyKind.CommonJsRequire:
          magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.spec.value));
          magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
          break;
        case Asset.DependencyKind.CommonJsRequireResolve:
          magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.spec.value));
          magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
          break;
      }
    }

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMapUrl = magicString
        .generateMap({
          includeContent: !this.href.match(/^https?:\/\//),
          hires: true,
        })
        .toUrl();

      sourceMapSuffix = `\n//# sourceMappingURL=${sourceMapUrl}`;
    }
    const codeWithMap = `${magicString.toString()}${sourceMapSuffix}`;

    return codeWithMap;
  }
}

export namespace Asset {
  export enum DependencyKind {
    CommonJsRequire = 'require',
    CommonJsRequireResolve = 'require.resolve',
  }

  export interface ResolvedDependency {
    type: DependencyKind;
    asset: Asset;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
    stableHref: string;
    stableRootHref: string;
  }

  export interface UnresolvedDependency {
    type: DependencyKind;
    callee: { start: number; end: number };
    spec: { start: number; end: number; value: string };
  }
}
