const RELATE_PATH_RX = /^[./]|^[a-z]+:/;
const SPEC_RX = /^((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

interface BareModuleSpec {
  nameSpec: string;
  name: string;
  spec: string;
  pathname: string;
}

export function isBareModuleSpecifier(spec: string): boolean {
  return !RELATE_PATH_RX.test(spec);
}

export function parseBareModuleSpec(spec: string): BareModuleSpec {
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
    nameSpec: matches[1],
    name: matches[2],
    spec: matches[3] || '',
    pathname: matches[4] || '',
  };
}
