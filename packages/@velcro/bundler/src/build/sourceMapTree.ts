import { SourceMapSegment } from 'magic-string';
import { decode } from 'sourcemap-codec';

/**
 * Copyright (c) Rollup 2020 authors: https://github.com/rollup/rollup/graphs/contributors)
 *
 * Copied with light modifications from:
 * https://github.com/rollup/rollup/blob/36a4527473ea1fe678ed866c9f8dfd3c2542cd22/src/utils/collapseSourcemaps.ts
 */

export class Source {
  content: string | null;
  filename: string;

  constructor(filename: string, content: string | null) {
    this.filename = filename;
    this.content = content;
  }

  traceSegment(line: number, column: number, name?: string): SourceMapSegmentObject {
    return { line, column, name, source: this };
  }
}

interface SourceMapSegmentObject {
  column: number;
  line: number;
  name?: string;
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
    const sourcesContent: (string | null)[] = [];
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

/**
 * This function attempts to compensate for the loss of precision when lower
 * layers of source maps have higher precision than upper layers, leading to
 * a loss of fidelity.
 *
 * The code was lifted from [Alec Larson](https://github.com/aleclarson)'s
 * [fork of sorcery](https://github.com/aleclarson/sorcery/blob/3934a3f38a6d8604fc9dbaa576cbb6e4d733040f/src/blend.js).
 *
 * NOTE: This function mutates the given node.
 *
 * @copyright [Alec Larson](https://github.com/aleclarson) 2018
 */
// function blend(node: Link) {
//   let mappings: SourceMapSegment[][] = []; // traced lines
//   let sources: (Link | Source)[] = []; // traced sources
//   let names: string[] = []; // traced symbols

//   // Precompute which source/line/column triples are mapped by the given node.
//   // These references are useful when interweaving old segments.
//   const refs: number[][][] = Object.keys(node.sources).map(() => []);

//   for (const segments of node.mappings) {
//     let segment: SourceMapSegment;
//     let lines: number[][];
//     let columns: number[];
//     for (let i = 0; i < segments.length; i++) {
//       segment = segments[i];

//       if (segment.length === 4 || segment.length === 5) {
//         lines = refs[segment[1]];
//         if (!lines) refs[segment[1]] = lines = [];

//         columns = lines[segment[2]];
//         if (columns) {
//           uniqueAscendingInsert(columns, segment[3]);
//         } else {
//           lines[segment[2]] = [segment[3]];
//         }
//       }
//     }
//   }

//   let traced: SourceMapSegment[] | undefined = undefined; // the traced line mapping
//   let untraced: SourceMapSegment[] | undefined = undefined; // the untraced line mapping

//   function addSegment(
//     segment: SourceMapSegment,
//     source?: { names: string[]; sources: (Link | Source)[] }
//   ) {
//     if (source) {
//       segment[1] = uniq<Link | Source>(sources, source.sources[segment[1]!]);
//       if (segment.length === 5) {
//         segment[4] = uniq(names, source.names[segment[4]]);
//       }
//     } else if (segment.length === 5) {
//       segment[4] = uniq(names, node.names[segment[4]]);
//     }
//     traced!.push(segment);
//   }

//   let tracedLine: number; // the last traced line
//   let generatedLine = -1; // the current line
//   let sourceIndex: number | undefined = -1; // source of last traced segment
//   let sourceLine: number | undefined = undefined; // source line of last traced segment

//   // Find the next line with segments.
//   function nextLine() {
//     tracedLine = generatedLine;
//     while (++generatedLine < node.mappings.length) {
//       untraced = node.mappings[generatedLine];
//       if (untraced.length) return true;
//     }
//   }

//   // Provide mappings for lines between the
//   // last traced line and the current line.
//   function fillSkippedLines() {
//     const skipped = generatedLine - (tracedLine + 1);
//     if (skipped !== 0) {
//       let line = tracedLine;

//       // Take line mappings from the current source.
//       if (sourceIndex !== -1) {
//         const source = node.sources[sourceIndex!];
//         if (source instanceof Link) {
//           while (line < generatedLine - 1) {
//             if (++sourceLine! !== source.mappings.length) {
//               mappings[++line] = traced = [];

//               // Check referenced columns to avoid duplicate segments.
//               const columns = refs[sourceIndex!][sourceLine!] || [];
//               let prevColumn = -1;

//               // Interweave old segments from the current source.
//               const segments = source.mappings[sourceLine!];
//               for (let i = 0; i < segments.length; i++) {
//                 const segment = segments[i];
//                 if (!hasValueBetween(columns, prevColumn, segment[0] + 1)) {
//                   addSegment([...segment] as SourceMapSegment, source);
//                   prevColumn = segment[0];
//                 } else break;
//               }
//             } else {
//               // End of source file.
//               sourceIndex = -1;
//               break;
//             }
//           }
//         }
//       }

//       // Default to empty arrays for unmapped lines.
//       while (++line < generatedLine) {
//         mappings[line] = [];
//       }
//     }
//   }

//   while (nextLine()) {
//     fillSkippedLines();

//     // Trace the segments of this generated line.
//     mappings[generatedLine] = traced = [];

//     // Interweave old segments before the first mapped column of each line.
//     const sourceColumn = untraced![0][3];
//     if (sourceIndex !== -1 && sourceColumn !== 0) {
//       const source = node.sources[sourceIndex];
//       if (source instanceof Link) {
//         const segments =
//           sourceLine! < source.mappings.length - 1 ? source.mappings[++sourceLine!] : [];

//         for (let i = 0; i < segments.length; i++) {
//           const segment = segments[i];
//           if (segment[0] < sourceColumn!) {
//             addSegment(segment.slice(0) as SourceMapSegment, source);
//           } else break;
//         }
//       }
//     }

//     const last = untraced!.length - 1;
//     untraced!.forEach((curr: SourceMapSegment | null, i) => {
//       [, sourceIndex, sourceLine] = curr!;

//       const source = node.sources[sourceIndex!];
//       if (source === null) {
//         curr![1] = uniq(sources, null);
//         return addSegment(curr!);
//       }
//       if (!(source instanceof Link)) {
//         curr![1] = uniq(sources, source);
//         return addSegment(curr!);
//       }

//       const next = i !== last ? untraced![i + 1] : null;
//       const sourceColumn = curr![3];
//       const generatedColumn = curr![0];

//       // Find the first segment with a greater column.
//       const segments = source.mappings[sourceLine!] || [];
//       let j = findGreaterColumn(segments, sourceColumn!);

//       // A "base segment" is required for tracing to a grand-parent.
//       let base;
//       if (--j !== -1) {
//         base = segments[j];
//         curr![1] = uniq(sources, source.sources[base[1]!]);
//         curr![2] = base[2];
//         curr![3] = base[3]! + sourceColumn! - base[0];
//         if (base.length === 5) {
//           // Inherit the names of aligned base segments.
//           if (base[0] === sourceColumn) {
//             curr![4] = uniq(names, source.names[base[4]!]);
//           }
//         } else if (curr!.length === 5) {
//           // When our segment is named and the base segment is not,
//           // assume this segment cannot be traced to its original source.
//           if (base[0] !== sourceColumn) curr = null;
//         }
//       } else {
//         curr![1] = uniq(sources, null);
//       }

//       curr && addSegment(curr);

//       // Check referenced columns to avoid duplicate segments.
//       const columns = refs[sourceIndex!][sourceLine!] || [];
//       let baseColumn = base ? base[0] : -1;

//       // Interweave old segments between our current and next segments.
//       const nextColumn = next ? next[0] : 1 / 0;
//       while (++j < segments.length) {
//         let segment = segments[j];

//         // The generated column is shifted to fit into the root source map.
//         const column = segment[0] + generatedColumn - sourceColumn!;
//         if (column >= nextColumn) break;

//         // Avoid duplicates by checking if this segment goes elsewhere.
//         if (!hasValueBetween(columns, baseColumn, segment[0] + 1)) {
//           baseColumn = segment[0];
//           segment = segment.slice(0) as SourceMapSegment;
//           segment[0] = column;
//           addSegment(segment, source);
//         } else break;
//       }
//     });
//   }
//   fillSkippedLines();

//   node.mappings = mappings;
//   node.sources = sources;
//   node.names = names;
//   return node;
// }

// // Check if a value exists before pushing it to an array.
// // Return the new or existing index of the value.
// function uniq<T>(arr: T[], val: T): number {
//   const i = arr.indexOf(val);
//   return ~i ? i : arr.push(val) - 1;
// }

// // Get the first segment with a greater column.
// function findGreaterColumn(segments: SourceMapSegment[], column: number) {
//   let low = 0,
//     high = segments.length;
//   while (low < high) {
//     const mid = (low + high) >>> 1;
//     segments[mid][0] <= column ? (low = mid + 1) : (high = mid);
//   }
//   return low;
// }

// // The range is exclusive.
// function hasValueBetween(arr: number[], start: number, end: number) {
//   let low = 0,
//     high = arr.length;
//   while (low < high) {
//     const mid = (low + high) >>> 1;
//     const val = arr[mid];
//     if (val <= start) {
//       low = mid + 1;
//     } else if (val >= end) {
//       high = mid;
//     } else {
//       return true;
//     }
//   }
//   return false;
// }

// // Insert unique values in ascending order.
// function uniqueAscendingInsert(arr: number[], val: number) {
//   let low = 0,
//     high = arr.length;
//   while (low < high) {
//     const mid = (low + high) >>> 1;
//     const x = arr[mid];
//     if (x === val) return;
//     if (x < val) {
//       low = mid + 1;
//     } else {
//       high = mid;
//     }
//   }
//   arr.splice(low, 0, val);
// }
