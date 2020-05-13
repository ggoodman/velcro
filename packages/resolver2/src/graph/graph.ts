import { Chunk } from '../build/chunk';
import { MapSet } from '../util/mapSet';
import { Uri } from '../util/uri';
import { DependencyEdge } from './dependencyEdge';
import { SourceModule } from './sourceModule';

export namespace Graph {
  export interface Options {
    edges: Iterable<DependencyEdge>;
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

  splitChunks(): Iterable<Chunk> {
    return [
      new Chunk({
        edges: this.edgesFrom.values(),
        rootUri: this.rootUri,
        sourceModules: this.sourceModules.values(),
      }),
    ];
  }
}
