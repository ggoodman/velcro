import { CancellationToken, CanceledError } from '@velcro/resolver';

const RELATE_PATH_RX = /^[./]|^[a-z_-]+:/;
const SPEC_RX = /^((@[^/]+\/[^/@]+|[^./@][^/@]*)(?:@([^/]+))?)(.*)?$/;

interface BareModuleSpec {
  nameSpec: string;
  name: string;
  spec: string;
  pathname: string;
}

export class Deferred<T = void> {
  public readonly promise: Promise<T>;
  private promiseResolve!: (value: T | PromiseLike<T>) => void;
  private promiseReject!: (reason?: any) => void;

  private internalState: 'pending' | 'rejected' | 'resolved' = 'pending';

  constructor(token?: CancellationToken) {
    this.promise = new Promise<T>((promiseResolve, promiseReject) => {
      this.promiseResolve = promiseResolve;
      this.promiseReject = promiseReject;
    });

    if (token) {
      if (token.isCancellationRequested) {
        this.reject(new CanceledError('Canceled'));
      } else {
        token.onCancellationRequested(() => {
          this.reject(new CanceledError('Canceled'));
        });
      }
    }
  }

  get isSettled() {
    return this.internalState !== 'pending';
  }

  get state() {
    return this.internalState;
  }

  resolve(value: T | PromiseLike<T>) {
    this.internalState = 'resolved';
    this.promiseResolve(value);
  }

  reject(reason?: any) {
    this.internalState = 'rejected';
    this.promiseReject(reason);
  }
}

export function isBareModuleSpecifier(spec: string): boolean {
  return !RELATE_PATH_RX.test(spec);
}

export function maybeParseBareModuleSpec(spec: string): BareModuleSpec | undefined {
  /**
   * 1: scope + name + version
   * 2: scope + name
   * 3: version?
   * 4: pathname
   */
  const matches = spec.match(SPEC_RX);

  if (!matches) {
    return undefined;
  }

  return {
    nameSpec: matches[1],
    name: matches[2],
    spec: matches[3] || '',
    pathname: matches[4] || '',
  };
}

export function parseBareModuleSpec(spec: string): BareModuleSpec {
  const parsed = maybeParseBareModuleSpec(spec);

  if (!parsed) {
    throw new Error(`Unable to parse unexpected unpkg url: '${spec}'`);
  }

  return parsed;
}

// this looks ridiculous, but it prevents sourcemap tooling from mistaking
// this for an actual sourceMappingURL

export function getSourceMappingUrl(str: string) {
  const re = /(?:\/\/[@#][\s]*(?:source)MappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*(?:source)MappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/gm;
  // Keep executing the search to find the *last* sourceMappingURL to avoid
  // picking up sourceMappingURLs from comments, strings, etc.
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(str))) lastMatch = match;

  if (!lastMatch) return null;

  return lastMatch[1];
}

export class MapSet<K, V> {
  private readonly m = new Map<K, Set<V>>();

  add(key: K, value: V) {
    let valueSet = this.m.get(key);

    if (!valueSet) {
      valueSet = new Set();
      this.m.set(key, valueSet);
    }

    valueSet.add(value);

    return this;
  }

  delete(key: K, value: V) {
    const valueSet = this.m.get(key);
    let deleted = false;

    if (valueSet) {
      deleted = valueSet.delete(value);

      if (deleted && !valueSet.size) {
        this.m.delete(key);
      }
    }

    return deleted;
  }

  deleteAll(key: K) {
    return this.m.delete(key);
  }

  getValues(key: K) {
    return new Set(this.m.get(key));
  }

  has(key: K, value: V) {
    const valueSet = this.m.get(key);

    return valueSet ? valueSet.has(value) : false;
  }
}
