export { CanceledError } from 'ts-primitives';

class ExtendableError extends Error {
  constructor(message: string) {
    super(message);

    this.name = this.constructor.name;

    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

export class ResolveError extends ExtendableError {
  constructor(readonly href: string, readonly fromHref?: string) {
    super(`Unable to resolve '${href}'${fromHref ? ` from '${fromHref}'` : ''}`);
  }
}
