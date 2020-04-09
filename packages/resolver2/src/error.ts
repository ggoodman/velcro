export class CanceledError extends Error {}

export class EntryNotFoundError extends Error {
  constructor(uri: { toString(): string }) {
    super(`Unable to resolve '${uri.toString()}'`);
  }
}
