import { Decoder } from './decoder';

export type PackageMainField = 'browser' | 'module' | 'jsnext:main' | 'main' | 'unpkg';

export type PackageJson = {
  name: string;
  version: string;
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
    !hasInvalidRequiredStringField(json as any, 'version') &&
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
    !Object.keys(json[field]).every(
      (key) => typeof key === 'string' && typeof json[field][key] === 'string'
    )
  );
}

export function parseBufferAsPackageJson(
  decoder: Decoder,
  content: ArrayBuffer,
  spec: string
): PackageJson {
  try {
    const text = decoder.decode(content);

    return parseTextAsPackageJson(text, spec);
  } catch (err) {
    throw new Error(`Error decoding manifest buffer for package ${spec}: ${err.message}`);
  }
}

function parseTextAsPackageJson(text: string, spec: string): PackageJson {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
  }

  if (!isValidPackageJson(json)) {
    throw new Error(`Invalid manifest for the package ${spec}`);
  }

  return json;
}
