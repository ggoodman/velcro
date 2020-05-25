import { Uri } from '@velcro/common';
import { Bundle, SourceMapSegment } from 'magic-string';
import { encode } from 'sourcemap-codec';
import { SourceModule } from '../graph/sourceModule';
import { SourceMap } from './sourceMap';
import { Link, Source } from './sourceMapTree';

export class ChunkOutput {
  private cachedCode?: string;
  private cachedSourceMap?: SourceMap;
  private cachedSourceMapDataUri?: string;
  private cachedSourceMapString?: string;

  constructor(
    private readonly bundle: Bundle,
    private readonly sourceModules: Map<string, SourceModule>,
    readonly uri: Uri
  ) {}

  get code() {
    if (typeof this.cachedCode === 'undefined') {
      this.cachedCode = this.bundle.toString();
    }

    return this.cachedCode!;
  }

  get href() {
    return this.uri.toString();
  }

  get sourceMap() {
    if (typeof this.cachedSourceMap === 'undefined') {
      this.cachedSourceMap = this.generateSourceMap();
    }

    return this.cachedSourceMap!;
  }

  get sourceMapString() {
    if (typeof this.cachedSourceMapString === 'undefined') {
      this.cachedSourceMapString = this.sourceMap.toString();
    }

    return this.cachedSourceMapString!;
  }

  get sourceMapDataUri() {
    if (typeof this.cachedSourceMapDataUri === 'undefined') {
      this.cachedSourceMapDataUri = this.sourceMap.toDataUri();
    }

    return this.cachedSourceMapDataUri!;
  }

  private generateSourceMap() {
    const inputMap = this.bundle.generateDecodedMap({
      includeContent: false,
      hires: true,
      source: this.href,
    });

    const sourceMapTree = new Link(
      inputMap,
      inputMap.sources.map((sourceHref) => {
        const sourceModule = this.sourceModules.get(sourceHref);

        if (!sourceModule) {
          return new Source(sourceHref, 'SOURCEMAP ERROR');
        }

        return sourceModule.sourceMapsTree;
      })
    );
    const sourceMapTreeMappings = sourceMapTree.traceMappings();

    if (sourceMapTreeMappings instanceof Error) {
      return new SourceMap({
        file: inputMap.file,
        mappings: '',
        names: [],
        sources: [],
        version: 3,
        sourcesContent: [],
      });
    }

    // Loop through generated mappings, removing mappings that are character-by-character increments
    // from the previous mapping. Since we generated a hires bundle, this will shrink the resolution
    // back down to something not unnecessarily large.
    for (const line of sourceMapTreeMappings.mappings) {
      let lastSegment: SourceMapSegment | null = null;
      const shrinkedLine: SourceMapSegment[] = [];

      for (const segment of line) {
        if (lastSegment && lastSegment.length >= 4 && lastSegment.length === segment.length) {
          // We will only push the segment if it is not, effectively a direct cursor move of the
          // last one.
          // For example:
          //   lastSegment = [1, 0, 0, 1] // Generated column 1, original column 1 of the 0th file, 0th line
          //   segment = [2, 0, 0, 2] // Generated column 2, original column 2 of the 0th file, 0th line
          // Given that, we can see that this segment is not adding any _new_ information so we can skip it.
          if (
            lastSegment.length >= 4 &&
            (lastSegment[0] + 1 !== segment[0] ||
              lastSegment[1] !== segment[1] ||
              lastSegment[2] !== segment[2] ||
              lastSegment[3]! + 1 !== segment[3] ||
              lastSegment[4] !== segment[4])
          ) {
            shrinkedLine.push(segment);
          }
        } else {
          shrinkedLine.push(segment);
        }

        lastSegment = segment;
      }

      line.splice(0, line.length, ...shrinkedLine);
    }

    const sourceMap = new SourceMap({
      file: this.href,
      mappings: encode(sourceMapTreeMappings.mappings),
      names: sourceMapTreeMappings.names,
      sources: sourceMapTreeMappings.sources,
      version: 3,
      sourcesContent: sourceMapTreeMappings.sourcesContent,
    });

    return sourceMap;
  }
}
