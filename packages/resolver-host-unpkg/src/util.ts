import { CancellationToken } from '@velcro/resolver';

import { Spec } from './types';

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

export function signalFromCancellationToken(
  token?: CancellationToken,
  AbortControllerConstructor?: typeof AbortController
): AbortSignal | undefined {
  if (!token || !AbortControllerConstructor) {
    return;
  }

  const abortController = new AbortControllerConstructor();

  if (token.isCancellationRequested) {
    abortController.abort();
  } else {
    token.onCancellationRequested(() => abortController.abort());
  }

  return abortController.signal;
}
