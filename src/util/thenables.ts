export function isThenable<T>(obj: T | PromiseLike<T>): obj is PromiseLike<T> {
  return typeof (obj as PromiseLike<T>).then === 'function';
}
