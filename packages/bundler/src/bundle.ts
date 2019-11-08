import remapping from '@ampproject/remapping';
import { Base64 } from 'js-base64';
import MagicString, { Bundle as MagicStringBundle } from 'magic-string';

import { Asset } from './asset';
import { InvariantViolation } from './error';
import { createRuntime } from './runtime';
import { RuntimeOptions } from './types';

export class Bundle {
  private readonly assetsByHref = new Map<string, Asset>();

  constructor(
    private readonly assets: Set<Asset>,
    private readonly entrypointsToAssets: Map<string, Asset>,
    private readonly dependenciesToAssets: Map<string, Asset>
  ) {
    for (const asset of assets) {
      this.assetsByHref.set(asset.href, asset);
    }
  }

  buildForImmediateExecution(
    options: { sourceMap?: boolean } & RuntimeOptions = {}
  ): { code: string; sourceMap?: SourceMap } {
    const bundle = new MagicStringBundle({ separator: '\n\t\t,\n' });

    for (const asset of this.assets) {
      bundle.addSource(buildAssetForImmediateExecution(asset));
    }

    const aliasMap = Array.from(this.dependenciesToAssets).reduce(
      (acc, [name, asset]) => {
        acc[name] = asset.href;
        return acc;
      },
      {} as Record<string, string>
    );
    const entrypointMap = Array.from(this.entrypointsToAssets).reduce(
      (acc, [name, asset]) => {
        acc[name] = asset.href;
        return acc;
      },
      {} as Record<string, string>
    );
    const runtimeOptions: RuntimeOptions = {
      executeEntrypoints: options.executeEntrypoints,
      runtime: options.runtime,
    };

    bundle.prepend(
      `(${createRuntime.toString()})({\n\taliases:${JSON.stringify(aliasMap)},\n\tentrypoints:${JSON.stringify(
        entrypointMap
      )},\n\tmodules:{\n`
    );
    bundle.append(`\n\t}\n}, ${JSON.stringify(runtimeOptions)});`);

    const code = bundle.toString();
    const sourceMap = options.sourceMap ? this.generateSourceMap(bundle, '') : undefined;

    return {
      code,
      sourceMap,
    };
  }

  toString(options: { sourceMap?: boolean } & RuntimeOptions = {}) {
    const { code, sourceMap } = this.buildForImmediateExecution(options);

    return code + (sourceMap ? `\n//# sourceMappingURL=${sourceMap.toDataUri()}` : '');
  }

  private generateSourceMap(bundle: MagicStringBundle | MagicString, href: string) {
    const inputMap = bundle.generateMap({
      includeContent: true,
      hires: false,
      source: href,
    });

    // In case a source map seems to be self-referential, avoid crashing
    const seen = new Set<Asset>();

    return new SourceMap(
      remapping(
        inputMap.toString(),
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
      )
    );
  }
}

class SourceMap {
  readonly file?: string;
  readonly mappings: string;
  readonly sourceRoot?: string;
  readonly names: string[];
  readonly sources: string[];
  readonly sourcesContent?: (string | null)[];
  readonly version: 3;

  constructor(input: {
    file?: string;
    mappings: string;
    sourceRoot?: string;
    names: string[];
    sources: string[];
    sourcesContent?: (string | null)[];
    version: 3;
  }) {
    this.file = input.file;
    this.mappings = input.mappings;
    this.sourceRoot = input.sourceRoot;
    this.names = input.names;
    this.sources = input.sources;
    this.sourcesContent = input.sourcesContent;
    this.version = input.version;
  }

  toString() {
    return JSON.stringify(this);
  }

  toDataUri() {
    return `data:application/json;charset=utf-8;base64,${Base64.encode(this.toString())}`;
  }
}

function buildAssetAndCollectDependencies(
  asset: Asset,
  indent = '\t'
): { dependencies: Record<string, string>; magicString: MagicString } {
  if (!asset.magicString) {
    throw new InvariantViolation(`Invariant violation: asset is not loaded '${asset.href}'`);
  }

  const dependencies = {} as Record<string, string>;
  const magicString = asset.magicString.clone();

  magicString.trim();
  magicString.indent(indent);

  // We'll replace each dependency string with the resolved stable href. The stable href doesn't require any
  // information about where it is being resolved from, so it is useful as a long-term pointer whose target
  // can change over time
  for (const dependency of asset.dependencies) {
    switch (dependency.type) {
      case Asset.DependencyKind.Require: {
        // magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.href));
        // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
        dependencies[dependency.spec.value] = dependency.href;
        break;
      }
      case Asset.DependencyKind.RequireResolve: {
        // magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.href));
        // magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
        dependencies[dependency.spec.value] = dependency.href;
        break;
      }
      case Asset.DependencyKind.InjectedGlobal: {
        magicString.prepend(
          `\n${indent}const ${dependency.symbolName} = require(${JSON.stringify(dependency.symbolName)})${
            dependency.exportName ? `.${dependency.exportName}` : ''
          };\n`
        );
        dependencies[dependency.symbolName] = dependency.href;
        break;
      }
      default:
        throw new Error(`Invariant violation: Encountered unexpected dependency kind '${(dependency as any).type}'`);
    }
  }

  return { dependencies, magicString };
}

function buildAssetForImmediateExecution(asset: Asset) {
  const { dependencies, magicString } = buildAssetAndCollectDependencies(asset, '\t\t\t\t');

  magicString.prepend(
    `\t\t${JSON.stringify(asset.href)}: {\n\t\t\tdependencies: ${JSON.stringify(
      dependencies
    )},\n\t\t\tfactory: function(module, exports, require, __dirname, __filename){\n\t\t\t\tvar __webpack_require__ = require;\n`
  );
  magicString.append('\n\t\t}}');

  return magicString;
}
