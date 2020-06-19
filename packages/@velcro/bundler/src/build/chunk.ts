import { MapSet, Uri } from '@velcro/common';
import { Bundle } from 'magic-string';
import { DependencyEdge } from '../graph/dependencyEdge';
import { SourceModule } from '../graph/sourceModule';
import { createRuntime } from '../runtime/runtime';
import { VelcroImportMap, VelcroStaticRuntime } from '../runtime/types';
import { ChunkOutput } from './chunkOutput';

type NotUndefined<T> = T extends undefined ? never : T;

export class Chunk {
  private readonly edgesFrom = new MapSet<string, DependencyEdge>();
  private readonly edgesTo = new MapSet<string, DependencyEdge>();
  //@ts-ignore
  private readonly rootUri: Uri;
  private readonly sourceModules = new Map<string, SourceModule>();

  constructor(options: Chunk.Options) {
    this.rootUri = options.rootUri;

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
    // const velcroModuleFactoryParts = velcroModuleFactory
    //   .toString()
    //   .split(velcroModuleFactory.splitString);
    // const velcroChunkWrapperParts = velcroChunkWrapper
    //   .toString()
    //   .split(velcroChunkWrapper.splitString);

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

    const velcroStaticRuntime: VelcroStaticRuntime = { defs: {} };

    bundle.prepend(`(function(velcro){\n`);
    bundle.prepend(
      `if (typeof Velcro === 'undefined') Velcro = Object.create(null);\nif (typeof Velcro.registry === 'undefined') Velcro.registry = ${JSON.stringify(
        velcroStaticRuntime
      )};\n`
    );
    bundle.append(`\n})(Velcro.registry);\n`);

    if (options && options.injectRuntime) {
      bundle.append(`\nVelcro.runtime = ${createRuntime.toString()}(Velcro.registry);\n`);
    }

    if (options && options.invalidations) {
      if (!options.injectRuntime) {
        throw new Error(
          'Setting injectRuntime to true is required when calling buildForStaticRuntime and specifying invalidations'
        );
      }

      bundle.append(`\nVelcro.runtime.invalidate(${JSON.stringify(options.invalidations)});\n`);
    }

    return new ChunkOutput(bundle, this.sourceModules, this.rootUri);
  }
}

export namespace Chunk {
  export interface Options {
    edges: Iterable<DependencyEdge>;
    rootUri: Uri;
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
