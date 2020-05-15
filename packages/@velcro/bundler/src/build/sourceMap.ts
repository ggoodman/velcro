import { Base64 } from '@velcro/common';

export class SourceMap {
  readonly file?: string;
  readonly mappings: string;
  readonly sourceRoot?: string;
  readonly names: string[];
  readonly sources: (string | null)[];
  readonly sourcesContent?: (string | null)[];
  readonly version: 3;

  constructor(input: {
    file?: string;
    mappings: string;
    sourceRoot?: string;
    names: string[];
    sources: (string | null)[];
    sourcesContent?: (string | null)[];
    version: 3;
  }) {
    this.file = input.file;
    this.mappings = input.mappings;
    this.sourceRoot = input.sourceRoot;
    this.names = input.names;
    this.sources = input.sources;
    this.sourcesContent = input.sourcesContent;
    this.version = input.version;
  }

  toString() {
    return JSON.stringify(this);
  }

  toDataUri() {
    return `data:application/json;charset=utf-8;base64,${Base64.encode(this.toString())}`;
  }
}

export function getSourceMappingUrl(str: string) {
  const re = /(?:\/\/[@#][\s]*(?:source)MappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*(?:source)MappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/gm;
  // Keep executing the search to find the *last* sourceMappingURL to avoid
  // picking up sourceMappingURLs from comments, strings, etc.
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(str))) lastMatch = match;

  if (!lastMatch) return '';

  return lastMatch[1];
}
