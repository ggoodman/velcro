const SPEC_RX = /^((@[^/]+\/[^/@]+|[^./@][^/@]*)(?:@([^/]+))?)(\/.*)?$/;

export function parseBareModuleSpec(bareModuleSpec: string) {
  const matches = bareModuleSpec.match(SPEC_RX);

  if (matches) {
    const [, nameSpec, name, spec, path = ''] = matches as [
      string,
      string,
      string,
      string,
      string | undefined
    ];

    return {
      nameSpec,
      name,
      spec,
      path,
    };
  }

  return null;
}
