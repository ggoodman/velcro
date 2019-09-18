const RELATE_PATH_RX = /^[./]|^[a-z_-]+:/;
const SPEC_RX = /^((@[^/]+\/[^/@]+|[^./@][^/@]*)(?:@([^/]+))?)(.*)?$/;

interface BareModuleSpec {
  nameSpec: string;
  name: string;
  spec: string;
  pathname: string;
}

export class Deferred<T = unknown> {
  public readonly promise: Promise<T>;
  private promiseResolve!: (value: T | PromiseLike<T>) => void;
  private promiseReject!: (reason?: any) => void;

  private internalState: 'pending' | 'rejected' | 'resolved' = 'pending';

  constructor() {
    this.promise = new Promise<T>((promiseResolve, promiseReject) => {
      this.promiseResolve = promiseResolve;
      this.promiseReject = promiseReject;
    });
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
    throw new Error(`Unable to parse unexpected unpkg url: ${spec}`);
  }

  return parsed;
}
