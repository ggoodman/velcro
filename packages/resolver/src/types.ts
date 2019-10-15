export type PackageMainField = 'browser' | 'module' | 'jsnext:main' | 'main' | 'unpkg';

export interface ResolveDetails {
  ignored: boolean;
  resolvedUrl?: URL;
  rootUrl: URL;
}

export enum ResolvedEntryKind {
  Directory = 'directory',
  File = 'file',
}

export type ResolvedEntry = {
  url: URL;
  type: ResolvedEntryKind;
};

export type PackageJson = {
  name: string;
  version?: string;
  browser?: string | { [key: string]: false | string };
  main?: string;
  module?: string;
  'jsnext:main'?: string;
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
  peerDependencies?: { [key: string]: string };
  unpkg?: string;
};

export function isValidPackageJson(json: unknown): json is PackageJson {
  return (
    typeof json === 'object' &&
    json !== null &&
    !hasInvalidRequiredStringField(json as any, 'name') &&
    !hasInvalidOptionalStringField(json as any, 'version') &&
    !hasInvalidBrowserField(json as any) &&
    !hasInvalidOptionalStringField(json as any, 'main') &&
    !hasInvalidOptionalStringField(json as any, 'module') &&
    !hasInvalidOptionalStringField(json as any, 'jsnext:main') &&
    !hasInvalidOptionalStringField(json as any, 'unpkg') &&
    !hasInvalidDependenciesField(json as any, 'dependencies') &&
    !hasInvalidDependenciesField(json as any, 'devDependencies') &&
    !hasInvalidDependenciesField(json as any, 'peerDependencies')
  );
}

function hasInvalidBrowserField(json: any) {
  let error = '';

  const browser = json.browser;
  if (browser) {
    if (typeof browser === 'object') {
      for (const key in browser) {
        if (typeof key !== 'string') {
          error = `The key ${key} of .browser must be a string`;
          break;
        }
        if (typeof browser[key] !== 'string' && browser[key] !== false) {
          error = `The value ${key} of .browser must be a string or false`;
          break;
        }
      }
    }
  }

  return error;
}

function hasInvalidRequiredStringField(json: any, field: string) {
  return typeof json[field] !== 'string';
}

function hasInvalidOptionalStringField(json: any, field: string) {
  return json[field] !== undefined && typeof json[field] !== 'string';
}

function hasInvalidDependenciesField(json: any, field: string) {
  return (
    json[field] !== undefined &&
    typeof json[field] === 'object' &&
    json[field] !== null &&
    !Object.keys(json[field]).every(key => typeof key === 'string' && typeof json[field][key] === 'string')
  );
}
