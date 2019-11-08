import { CancellationToken } from '@velcro/resolver';

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
