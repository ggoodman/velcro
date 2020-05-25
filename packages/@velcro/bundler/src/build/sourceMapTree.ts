import { SourceMapSegment } from 'magic-string';
import { decode } from 'sourcemap-codec';

/**
 * Copyright (c) Rollup 2020 authors: https://github.com/rollup/rollup/graphs/contributors)
 *
 * Copied with light modifications from:
 * https://github.com/rollup/rollup/blob/36a4527473ea1fe678ed866c9f8dfd3c2542cd22/src/utils/collapseSourcemaps.ts
 */

export class Source {
  content: string;
  filename: string;

  constructor(filename: string, content: string) {
    this.filename = filename;
    this.content = content;
  }

  traceSegment(line: number, column: number, name: string): SourceMapSegmentObject {
    return { line, column, name, source: this };
  }
}

interface SourceMapSegmentObject {
  column: number;
  line: number;
  name: string;
  source: Source;
}

export class Link {
  mappings: SourceMapSegment[][];
  names: string[];
  sources: (Source | Link)[];

  constructor(
    map: { mappings: SourceMapSegment[][] | string; names: string[] },
    sources: (Source | Link)[]
  ) {
    this.sources = sources;
    this.names = map.names;
    this.mappings = typeof map.mappings === 'string' ? decode(map.mappings) : map.mappings;
  }

  traceMappings() {
    const sources: string[] = [];
    const sourcesContent: string[] = [];
    const names: string[] = [];
    const mappings = [];

    for (const line of this.mappings) {
      const tracedLine: SourceMapSegment[] = [];

      for (const segment of line) {
        if (segment.length == 1) continue;
        const source = this.sources[segment[1]];
        if (!source) continue;

        const traced = source.traceSegment(
          segment[2],
          segment[3],
          segment.length === 5 ? this.names[segment[4]] : ''
        );

        if (traced) {
          // newer sources are more likely to be used, so search backwards.
          let sourceIndex = sources.lastIndexOf(traced.source.filename);
          if (sourceIndex === -1) {
            sourceIndex = sources.length;
            sources.push(traced.source.filename);
            sourcesContent[sourceIndex] = traced.source.content;
          } else if (sourcesContent[sourceIndex] == null) {
            sourcesContent[sourceIndex] = traced.source.content;
          } else if (
            traced.source.content != null &&
            sourcesContent[sourceIndex] !== traced.source.content
          ) {
            return new Error(
              `Multiple conflicting contents for sourcemap source ${traced.source.filename}`
            );
          }

          const tracedSegment: SourceMapSegment = [
            segment[0],
            sourceIndex,
            traced.line,
            traced.column,
          ];

          if (traced.name) {
            let nameIndex = names.indexOf(traced.name);
            if (nameIndex === -1) {
              nameIndex = names.length;
              names.push(traced.name);
            }

            (tracedSegment as SourceMapSegment)[4] = nameIndex;
          }

          tracedLine.push(tracedSegment);
        }
      }

      mappings.push(tracedLine);
    }

    return { sources, sourcesContent, names, mappings };
  }

  traceSegment(line: number, column: number, name: string): SourceMapSegmentObject | null {
    const segments = this.mappings[line];
    if (!segments) return null;

    // binary search through segments for the given column
    let i = 0;
    let j = segments.length - 1;

    const checks = [];

    while (i <= j) {
      const m = (i + j) >> 1;
      const segment = segments[m];
      checks.push(segment);
      if (segment[0] === column) {
        if (segment.length == 1) return null;
        const source = this.sources[segment[1]];
        if (!source) return null;

        return source.traceSegment(
          segment[2],
          segment[3],
          segment.length === 5 ? this.names[segment[4]] : name
        );
      }
      if (segment[0] > column) {
        j = m - 1;
      } else {
        i = m + 1;
      }
    }

    return null;
  }
}
