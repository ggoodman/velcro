import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import MagicString from 'magic-string';

import { Bundler } from './bundler';
import { parseFile } from './parser';
import { getSourceMappingUrl } from './util';

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

export class Asset {
  dependencies: Asset.Dependency[] | undefined = undefined;
  magicString?: MagicString;
  sourceMappingUrl?: string | null;

  constructor(readonly href: string, readonly rootHref: string) {}

  setCode(code: string): Asset.Dependency[] {
    this.magicString = new MagicString(code, {
      filename: this.href,
      indentExclusionRanges: [],
    });
    this.sourceMappingUrl = getSourceMappingUrl(code);

    const parser = getParserForAsset(this);
    const dependencies = parser.parse(this.href, this.magicString);

    this.dependencies = [];

    for (const dep of dependencies.requireDependencies) {
      this.dependencies.push({
        type: Asset.DependencyKind.Require,
        callee: dep.callee,
        references: [{ start: dep.spec.start, end: dep.spec.end }],
        value: dep.spec.value,
      });
    }

    for (const dep of dependencies.requireResolveDependencies) {
      this.dependencies.push({
        type: Asset.DependencyKind.RequireResolve,
        callee: dep.callee,
        references: [{ start: dep.spec.start, end: dep.spec.end }],
        value: dep.spec.value,
      });
    }

    for (const [symbolName, references] of dependencies.unboundSymbols) {
      const shim = DEFAULT_SHIM_GLOBALS[symbolName];

      if (shim) {
        this.dependencies.push({
          type: Asset.DependencyKind.InjectedGlobal,
          exportName: shim.export,
          references,
          symbolName,
          value: `${shim.spec}${shim.export ? `[${JSON.stringify(shim.export)}]` : ''}`,
        });
      }
    }

    return this.dependencies;
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

    asset.dependencies = json.dependencies;
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
    resolveDetails?: Bundler.ResolveDetails;
    callee: { start: number; end: number };
    references: ReadonlyArray<{ start: number; end: number }>;
    value: string;
  }

  export interface RequireResolveDependency {
    type: DependencyKind.RequireResolve;
    resolveDetails?: Bundler.ResolveDetails;
    callee: { start: number; end: number };
    references: ReadonlyArray<{ start: number; end: number }>;
    value: string;
  }

  export interface InjectedGlobalDependency {
    type: DependencyKind.InjectedGlobal;
    resolveDetails?: Bundler.ResolveDetails;
    exportName?: string;
    references: ReadonlyArray<{ start: number; end: number }>;
    symbolName: string;
    value: string;
  }

  export type Dependency = RequireDependency | RequireResolveDependency | InjectedGlobalDependency;
}

function getParserForAsset(asset: Asset): { parse: typeof parseFile } {
  if (asset.href.endsWith('.css')) {
    return {
      parse: (_href, magicString): ReturnType<typeof parseFile> => {
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
                magicString.overwrite(i, i + 1, ' ');
                break;
              case SINGLE_QUOTE:
                magicString.prependRight(i, '\\');
                break;
            }
          }

          escaped = false;
        }

        magicString.prepend(`
          function reload(){
            var styleTag = document.createElement("style");
            styleTag.type = "text/css";
            styleTag.innerHTML = '`);
        magicString.append(`';
            document.head.appendChild(styleTag);

            return function() {    
              if (styleTag && styleTag.parentElement) {
                styleTag.parentElement.removeChild(styleTag);
              }
            };
          };

          var remove = reload();

          if (module.hot && module.hot.dispose) {
            module.hot.dispose(function() {
              remove();
            });
          }
        `);

        return {
          requireDependencies: [],
          requireResolveDependencies: [],
          unboundSymbols: new Map(),
        };
      },
    };
  }

  if (asset.href.endsWith('.json')) {
    return {
      parse: (_href, magicString): ReturnType<typeof parseFile> => {
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
