import { Bundle } from 'magic-string';
import { MapSet } from '../mapSet';
import { createRuntime } from '../runtime/runtime';
import {
  velcroChunkWrapper,
  VelcroImportMap,
  velcroModuleFactory,
  VelcroStaticRuntime,
} from '../runtime/types';
import { Uri } from '../uri';
import { DependencyEdge } from './dependencyEdge';
import { SourceModule } from './sourceModule';

type NotUndefined<T> = T extends undefined ? never : T;

export namespace Graph {
  export interface Options {
    edges: Set<DependencyEdge>;
    rootUri: Uri;
    sourceModules: Iterable<SourceModule>;
  }
}

export class Graph {
  private readonly edgesFrom = new MapSet<string, DependencyEdge>();
  private readonly edgesTo = new MapSet<string, DependencyEdge>();
  //@ts-ignore
  private readonly rootUri: Uri;
  private readonly sourceModules = new Map<string, SourceModule>();

  constructor(options: Graph.Options) {
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

  toString() {
    const velcroModuleFactoryParts = velcroModuleFactory
      .toString()
      .split(velcroModuleFactory.splitString);
    const velcroChunkWrapperParts = velcroChunkWrapper
      .toString()
      .split(velcroChunkWrapper.splitString);

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

      sourceModule.source.prepend(
        `velcro.defs[${JSON.stringify(sourceModule.uri.toString())}] = [${
          velcroModuleFactoryParts[0]
        }`.replace(velcroModuleFactory.name, '')
      );
      sourceModule.source.append(`${velcroModuleFactoryParts[1]},${JSON.stringify(importMap)}];`);
      bundle.addSource(sourceModule.source);
    }

    const velcroStaticRuntime: VelcroStaticRuntime = { defs: {} };
    // const ident: VelcroModuleIdentification = {
    //   name: chunk.parentPackageJson.packageJson.name,
    //   version: chunk.parentPackageJson.packageJson.version,
    //   path: chunk.parsedSpec?.path ?? '',
    // };

    // bundle.prepend(`  velcro.loc[${JSON.stringify(chunk.href)}] = ${JSON.stringify(ident)};\n`);
    bundle.prepend(`(${velcroChunkWrapperParts[0]}`.replace(velcroChunkWrapper.name, ''));
    bundle.append(
      `${velcroChunkWrapperParts[1]})(Velcro = typeof Velcro === 'undefined' ? ${JSON.stringify(
        velcroStaticRuntime
      )} : Velcro);\n`
    );
    bundle.append(`\nVelcro.runtime = ${createRuntime.toString()}(Velcro);\n`);

    console.log(bundle.toString());
  }
}
