export class Queue {
  private pendingCount = 0;
  private resolvedPromise = Promise.resolve();
  private waiters = [] as { resolve: () => void; reject: (err: Error) => void }[];

  constructor() {}

  get size() {
    return this.pendingCount;
  }

  add<T>(job: () => Promise<T>) {
    this.pendingCount++;

    this.resolvedPromise.then(job).then(
      result => {
        this.pendingCount--;

        if (this.pendingCount < 0) {
          throw new Error(`Invariant violation: queue pending count fell below 0`);
        }

        if (this.pendingCount === 0) {
          this.releaseWithSuccess();
        }

        return result;
      },
      err => {
        this.pendingCount--;

        this.releaseWithError(err);

        throw err;
      }
    );
  }

  wait(): Promise<void> {
    let resolve: any = undefined;
    let reject: any = undefined;

    const promise = new Promise<void>((promiseResolve, promiseReject) => {
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

        waiter.resolve();
      }
    });
  }
}
