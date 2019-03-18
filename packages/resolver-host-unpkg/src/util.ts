import { Decoder } from '@velcro/decoder';
import { failure } from 'io-ts/lib/PathReporter';

import { Spec, PackageJson } from './types';

const UNPKG_SPEC_RX = /^\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;
export function parseUnpkgUrl(url: URL | string): Spec {
  if (url instanceof URL) {
    url = url.pathname;
  }

  /**
   * 1: scope + name + version
   * 2: scope + name
   * 3: version?
   * 4: pathname
   */
  const matches = url.match(UNPKG_SPEC_RX);

  if (!matches) {
    throw new Error(`Unable to parse unexpected unpkg url: ${url}`);
  }

  return {
    spec: matches[1],
    name: matches[2],
    version: matches[3] || '',
    pathname: matches[4] || '',
  };
}

const SPEC_RX = /^((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;
export function parseModuleSpec(spec: string): Spec {
  /**
   * 1: scope + name + version
   * 2: scope + name
   * 3: version?
   * 4: pathname
   */
  const matches = spec.match(SPEC_RX);

  if (!matches) {
    throw new Error(`Unable to parse unexpected unpkg url: ${spec}`);
  }

  return {
    spec: matches[1],
    name: matches[2],
    version: matches[3] || '',
    pathname: matches[4] || '',
  };
}

export function parseBufferAsPackageJson(decoder: Decoder, content: ArrayBuffer, spec?: string) {
  let json: unknown;

  try {
    const text = decoder.decode(content);
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
  }

  const manifest = PackageJson.decode(json).getOrElseL(errors => {
    throw new Error(`Unexpected manifest for the package ${spec}: ${failure(errors).join(', ')}`);
  });

  return manifest;
}
