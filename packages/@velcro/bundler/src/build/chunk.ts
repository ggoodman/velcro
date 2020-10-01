import { MapSet, Uri } from '@velcro/common';
import type { VelcroImportMap, VelcroModuleRegistry } from '@velcro/runtime';
import { runtime } from '@velcro/runtime';
import { Bundle } from 'magic-string';
import type { DependencyEdge } from '../graph/dependencyEdge';
import type { SourceModule } from '../graph/sourceModule';
import { ChunkOutput } from './chunkOutput';
import { LazyLink, Link, Source } from './sourceMapTree';

type NotUndefined<T> = T extends undefined ? never : T;

export class Chunk {
  private readonly edgesFrom = new MapSet<string, DependencyEdge>();
  private readonly edgesTo = new MapSet<string, DependencyEdge>();
  private readonly entrypoints: ReadonlyArray<Uri>;
  private readonly sourceModules = new Map<string, SourceModule>();

  constructor(options: Chunk.Options) {
    this.entrypoints = options.entrypoints;

    for (const sourceModule of options.sourceModules) {
      this.sourceModules.set(sourceModule.href, sourceModule);
    }

    for (const edge of options.edges) {
      const fromHref = edge.fromUri.toString();
      const toHref = edge.toUri.toString();

      this.edgesFrom.add(fromHref, edge);
      this.edgesTo.add(toHref, edge);
    }
  }

  buildForStaticRuntime(options?: Chunk.ToStringOptions) {
    const bundle = new Bundle({
      separator: '\n',
    });

    for (const sourceModule of this.sourceModules.values()) {
      const moduleScopes: NotUndefined<NotUndefined<VelcroImportMap['scopes']>[string]> = {};
      const scopes: NotUndefined<VelcroImportMap['scopes']> = {
        [sourceModule.href]: moduleScopes,
      };
      const importMap: VelcroImportMap = { scopes };
      const edgesFrom = this.edgesFrom.get(sourceModule.href);

      if (edgesFrom) {
        for (const edge of edgesFrom) {
          moduleScopes[edge.dependency.spec] = edge.toUri.toString();
        }
      }
      const sourceModuleCode = sourceModule.source.clone();

      sourceModuleCode.prepend(
        `velcro.defs[${JSON.stringify(
          sourceModule.uri.toString()
        )}] = [function(module,exports,require,__dirname,__filename){\n`
      );
      sourceModuleCode.append(`\n},${JSON.stringify(importMap)}];`);
      bundle.addSource(sourceModuleCode);
    }

    const velcroStaticRuntime: VelcroModuleRegistry = { defs: {} };

    bundle.prepend(`(function(velcro){\n`);
    bundle.prepend(
      `if (typeof Velcro === 'undefined') Velcro = Object.create(null);\nif (typeof Velcro.registry === 'undefined') Velcro.registry = ${JSON.stringify(
        velcroStaticRuntime
      )};\n`
    );
    bundle.append(`\n})(Velcro.registry);\n`);

    if (options && options.injectRuntime) {
      bundle.append(`\n${runtime}(Velcro);\n`);
    }

    if (options && options.invalidations) {
      if (!options.injectRuntime) {
        throw new Error(
          'Setting injectRuntime to true is required when calling buildForStaticRuntime and specifying invalidations'
        );
      }

      bundle.append(`\nVelcro.runtime.invalidate(${JSON.stringify(options.invalidations)});\n`);
    }

    const sourceMapTree = new LazyLink(() => {
      const inputMap = bundle.generateDecodedMap({
        includeContent: false,
        hires: true,
        // source: this.rootUri.toString(),
      });
      return new Link(
        inputMap,
        inputMap.sources.map((sourceHref) => {
          const sourceModule = this.sourceModules.get(sourceHref);

          if (!sourceModule) {
            return new Source(sourceHref, 'SOURCEMAP ERROR');
          }

          // All of the transformations included in the source module's magicString
          // were baked into the bundle already. We just need to map these into any
          // earlier sources.
          return sourceModule.sourceMapsTree;
        })
      );
    });

    return new ChunkOutput(bundle, sourceMapTree, this.entrypoints);
  }
}

export namespace Chunk {
  export interface Options {
    edges: Iterable<DependencyEdge>;
    entrypoints: Array<Uri>;
    sourceModules: Iterable<SourceModule>;
  }

  export interface ToStringOptions {
    /**
     * Toggle whether to inject the runtime in the generated code.
     *
     * An instance of the runtime is important as it is what will actually schedule
     * and execute code built for Velcro.
     *
     * When `injectRuntime` is `true`, the runtime code will be injected and the
     * instance of it will be exposed as `Velcro.runtime`.
     */
    injectRuntime?: boolean;
    invalidations?: string[];
  }
}
