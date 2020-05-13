import remapping from '@ampproject/remapping';
import { Bundle } from 'magic-string';
import { SourceModule } from '../graph/sourceModule';
import { SourceMap } from './sourceMap';

export class ChunkOutput<T extends string | undefined> {
  private cachedCode?: string;
  private cachedSourceMap?: SourceMap;
  private cachedSourceMapDataUri?: string;
  private cachedSourceMapString?: string;

  constructor(
    private readonly bundle: Bundle,
    private readonly sourceModules: Map<string, SourceModule>,
    readonly href: T
  ) {}

  get code() {
    if (typeof this.cachedCode === 'undefined') {
      this.cachedCode = this.bundle.toString();
    }

    return this.cachedCode!;
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
      includeContent: true,
      hires: false,
      source: this.href,
      file: this.href,
    });

    // In case a source map seems to be self-referential, avoid crashing
    const seen = new Set<SourceModule>();
    const remapped = remapping(
      {
        file: inputMap.file,
        mappings: inputMap.mappings,
        names: inputMap.names,
        sources: inputMap.sources,
        sourcesContent: inputMap.sourcesContent,
        version: 3,
      },
      (uri: string) => {
        const sourceModule = this.sourceModules.get(uri);

        if (sourceModule && sourceModule.sourceMappingUrl) {
          if (seen.has(sourceModule)) {
            return null;
          }

          seen.add(sourceModule);

          const match = sourceModule.sourceMappingUrl.match(
            /^data:application\/json;(?:charset=([^;]+);)?base64,(.*)$/
          );

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
    );

    return new SourceMap({
      file: inputMap.file,
      mappings: remapped.mappings,
      names: remapped.names,
      sources: remapped.sources,
      version: remapped.version,
      sourceRoot: remapped.sourceRoot,
      sourcesContent: remapped.sourcesContent,
    });
  }
}
