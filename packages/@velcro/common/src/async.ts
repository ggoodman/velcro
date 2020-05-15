import { CancellationToken } from 'ts-primitives';
import { CanceledError } from './error';

export type Awaited<T> = T extends Thenable<infer U> ? U : T;

export interface Thenable<T> {
  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise.
   * @param onfulfilled The callback to execute when the Promise is resolved.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of which ever callback is executed.
   */
  then<TResult>(
    onfulfilled?: (value: T) => TResult | Thenable<TResult>,
    onrejected?: (reason: any) => TResult | Thenable<TResult>
  ): Thenable<TResult>;
  then<TResult>(
    onfulfilled?: (value: T) => TResult | Thenable<TResult>,
    onrejected?: (reason: any) => void
  ): Thenable<TResult>;
}

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

export async function checkCancellation<T>(promise: Thenable<T>, token: CancellationToken) {
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

export function isThenable<T = unknown>(object: unknown): object is Thenable<T> {
  return object && typeof (object as any).then === 'function';
}
