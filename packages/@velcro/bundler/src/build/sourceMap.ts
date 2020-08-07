import { Base64 } from '@velcro/common';
import type { DecodedSourceMap } from 'magic-string';
import { decode } from 'sourcemap-codec';

export class SourceMap {
  readonly file?: string;
  readonly mappings: string;
  readonly sourceRoot?: string;
  readonly names: string[];
  readonly sources: (string | null)[];
  readonly sourcesContent?: (string | null)[];
  readonly version: number;

  constructor(input: {
    file?: string;
    mappings: string;
    sourceRoot?: string;
    names: string[];
    sources: (string | null)[];
    sourcesContent?: (string | null)[];
    version: string | number;
  }) {
    this.file = input.file;
    this.mappings = input.mappings;
    this.sourceRoot = input.sourceRoot;
    this.names = input.names;
    this.sources = input.sources;
    this.sourcesContent = input.sourcesContent;
    this.version = input.version as number | 0;
  }

  toString() {
    return JSON.stringify(this);
  }

  toDataUri() {
    return `data:application/json;charset=utf-8;base64,${Base64.encode(this.toString())}`;
  }
}

function getSourceMappingUrlMatch(str: string) {
  const re = /(?:(?:\/\/|\/\*)[@#][\s]*(?:source)MappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*(?:source)MappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/gm;
  // Keep executing the search to find the *last* sourceMappingURL to avoid
  // picking up sourceMappingURLs from comments, strings, etc.
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(str))) lastMatch = match;

  return lastMatch;
}

export function getSourceMappingUrl(str: string) {
  const lastMatch = getSourceMappingUrlMatch(str);

  if (!lastMatch) return '';

  return lastMatch[1];
}

export function updateSourceMappingUrl(str: string, url: string) {
  const lastMatch = getSourceMappingUrlMatch(str);

  if (!lastMatch) return str;

  return str.slice(0, lastMatch.index) + str.slice(lastMatch.index).replace(lastMatch[1], url);
}

export function decodeDataUriAsSourceMap(href: string): DecodedSourceMap | null {
  const match = href.match(/^data:application\/json;(?:charset=([^;]+);)?base64,(.*)$/);

  if (match) {
    if (match[1] && match[1] !== 'utf-8') {
      return null;
    }

    try {
      const decoded = JSON.parse(Base64.decode(match[2]));

      if (decoded.mappings === '') {
        return {
          file: '',
          mappings: [],
          names: [],
          sources: [],
          sourcesContent: [],
        };
      }

      if (typeof decoded.mappings === 'string') {
        decoded.mappings = decode(decoded.mappings);
      }

      return decoded;
    } catch (err) {
      return null;
    }
  }

  return null;
}
