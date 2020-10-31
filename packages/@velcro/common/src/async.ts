import type { CancellationToken } from 'ts-primitives';
import { CanceledError } from './error';

export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

// See: https://github.com/microsoft/TypeScript/pull/26063#issuecomment-461576933
export function all<T extends [unknown] | unknown[]>(values: T, token: CancellationToken) {
  let shouldAwait = false;

  const result = values.map((element) => {
    if (isThenable(element)) {
      shouldAwait = true;

      return checkCancellation(element, token);
    }

    return element;
  }) as T;

  if (shouldAwait) {
    return (Promise.all(result) as unknown) as Promise<{ [P in keyof T]: Awaited<T[P]> }>;
  }

  return values as { [P in keyof T]: Awaited<T[P]> };
}

export async function checkCancellation<T>(promise: PromiseLike<T>, token: CancellationToken) {
  try {
    const result = await promise;
    if (token.isCancellationRequested) {
      return Promise.reject(new CanceledError());
    }

    return result;
  } catch (err) {
    if (token.isCancellationRequested) {
      return Promise.reject(new CanceledError());
    }

    throw err;
  }
}

export function isThenable<T = unknown>(object: unknown): object is PromiseLike<T> {
  return (
    object &&
    // Detection of 'normal' thenable
    (typeof (object as any).then === 'function' ||
      // Detection for regenerator runtime state
      (typeof (object as any).done === 'boolean' &&
        typeof (object as any).next === 'number' &&
        typeof (object as any).pre === 'number'))
  );
}
