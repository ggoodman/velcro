const SPEC_RX = /^((@[^/]+\/[^/@]+|[^./@][^/@]*)(?:@([^/]+))?)(.*)?$/;

type _BareModuleSpec<T = ReturnType<typeof parseBareModuleSpec>> = T extends null | undefined
  ? never
  : T;
export type BareModuleSpec = _BareModuleSpec;

export function parseBareModuleSpec(bareModuleSpec: string) {
  const matches = bareModuleSpec.match(SPEC_RX);

  if (matches) {
    const [, nameSpec, name, spec, path = ''] = matches;

    return {
      nameSpec,
      name,
      spec,
      path,
    };
  }

  return null;
}
