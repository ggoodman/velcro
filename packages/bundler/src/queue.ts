import { Asset } from './asset';

export class Queue {
  private assets = new Set<Asset>();
  private pendingCount = 0;
  private resolvedPromise = Promise.resolve();
  private waiters = [] as { resolve: (assets: Set<Asset>) => void; reject: (err: Error) => void }[];

  constructor(private onEnqueue?: () => void, private onComplete?: () => void) {}

  get size() {
    return this.pendingCount;
  }

  add(job: () => Promise<Asset | undefined>) {
    this.pendingCount++;

    if (this.onEnqueue) {
      this.onEnqueue();
    }

    this.resolvedPromise.then(job).then(
      asset => {
        this.pendingCount--;

        if (this.onComplete) {
          this.onComplete();
        }

        if (asset) {
          this.assets.add(asset);
        }

        if (this.pendingCount < 0) {
          throw new Error(`Invariant violation: queue pending count fell below 0`);
        }

        if (this.pendingCount === 0) {
          this.releaseWithSuccess();
        }

        return asset;
      },
      err => {
        this.pendingCount--;

        if (this.onComplete) {
          this.onComplete();
        }

        this.releaseWithError(err);

        throw err;
      }
    );
  }

  wait(): Promise<Set<Asset>> {
    if (this.pendingCount === 0) {
      return Promise.resolve(this.assets);
    }

    let resolve: any = undefined;
    let reject: any = undefined;

    const promise = new Promise<Set<Asset>>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    this.waiters.push({ reject, resolve });

    return promise;
  }

  private releaseWithError(err: Error) {
    this.resolvedPromise.then(() => {
      while (this.waiters.length) {
        const waiter = this.waiters.shift()!;

        waiter.reject(err);
      }
    });
  }

  private releaseWithSuccess() {
    this.resolvedPromise.then(() => {
      while (this.waiters.length) {
        const waiter = this.waiters.shift()!;

        waiter.resolve(this.assets);
      }
    });
  }
}
