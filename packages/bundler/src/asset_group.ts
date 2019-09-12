import { Asset } from './asset';
import { Bundle } from 'magic-string';
import { maybeParseBareModuleSpec } from './util';

export class AssetGroup {
  private readonly assets = new Set<Asset>();

  constructor(public readonly baseHref: string) {}

  add(asset: Asset) {
    this.assets.add(asset);
  }

  generateCode(options: { sourceMap?: boolean } = {}): string {
    const bundle = new Bundle({ separator: ',\n' });

    const prelude = function(modules: Record<string, (exports: any, module: any, require: any) => any>) {
      const installedModules = {} as Record<string, any>;
      function __velcro_require(stableHref: string) {
        let module = installedModules[stableHref];

        if (!module) {
          module = {
            exports: {},
          };

          const factory = modules[stableHref];

          if (!factory) {
            throw new Error(`Module not found for ${stableHref}`);
          }

          factory.call(module.exports, module, module.exports, __velcro_require);

          return module.exports;
        }
      }

      return __velcro_require;
    };

    for (const asset of this.assets) {
      const magicString = asset.magicString.clone();

      magicString.trim();
      magicString.prepend(
        `${JSON.stringify(asset.href)}: (function(module, exports, __velcro_require, __dirname, __filename){\n`
      );
      magicString.append('\n})');

      // We'll replace each dependency string with the resolved stable href. The stable href doesn't require any
      // information about where it is being resolved from, so it is useful as a long-term pointer whose target
      // can change over time
      for (const dependency of asset.dependencies) {
        switch (dependency.type) {
          case Asset.DependencyKind.CommonJsRequire:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.stableHref));
            magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require');
            break;
          case Asset.DependencyKind.CommonJsRequireResolve:
            magicString.overwrite(dependency.spec.start, dependency.spec.end, JSON.stringify(dependency.stableHref));
            magicString.overwrite(dependency.callee.start, dependency.callee.end, '__velcro_require_resolve');
            break;
        }
      }

      magicString.trim();

      bundle.addSource(magicString);
    }

    bundle.prepend(`(${prelude.toString()})({`);
    bundle.append('})');

    let sourceMapSuffix = '';

    if (options.sourceMap) {
      const sourceMap = bundle.generateMap({
        includeContent: false,
        hires: false,
        file: this.baseHref,
      });

      sourceMap.file = this.baseHref;

      const sourceMapUrl = sourceMap.toUrl();

      sourceMapSuffix = `\n//# sourceMappingURL=${sourceMapUrl}`;
    }
    const codeWithMap = `${bundle.toString()}${sourceMapSuffix}`;

    return codeWithMap;
  }

  generateLinkManifest(): AssetGroup.DependencyManifest {
    const manifest: AssetGroup.DependencyManifest = {
      resolved: {},
      unresolved: {},
    };

    for (const ownAsset of this.assets) {
      for (const dependency of ownAsset.dependencies) {
        const parsedBareModule = maybeParseBareModuleSpec(dependency.spec.value);

        if (parsedBareModule) {
          if (
            manifest.unresolved[parsedBareModule.nameSpec] &&
            manifest.unresolved[parsedBareModule.nameSpec] !== dependency.stableRootHref
          ) {
            throw new Error(
              `Conflicting dependencies from ${ownAsset.href} for ${parsedBareModule.nameSpec}: '${
                manifest.unresolved[parsedBareModule.nameSpec]
              }' vs '${dependency.asset.href}'`
            );
          }

          manifest.unresolved[parsedBareModule.nameSpec] = dependency.stableRootHref;
          manifest.resolved[dependency.stableRootHref] = dependency.asset.rootHref;
        }
      }
    }

    return manifest;
  }
}

export namespace AssetGroup {
  export interface DependencyManifest {
    unresolved: Record<string, string>;
    resolved: Record<string, string>;
  }
}
