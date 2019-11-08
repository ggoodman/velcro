export class ExtendableError extends Error {
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

export class EntryNotFoundError extends ExtendableError {
  constructor(url: URL) {
    super(`Not found ${url.href}`);
  }
}

export class FetchError extends ExtendableError {
  constructor(href: string, err: Error) {
    super(`Error while fetching ${href}: ${err.name || Error}: ${err.message}`);
  }
}
