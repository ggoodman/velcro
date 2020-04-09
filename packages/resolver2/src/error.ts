import { Uri } from './uri';

export class CanceledError extends Error {}

export class EntryNotFoundError extends Error {
  constructor(uri: Uri) {
    super(`Unable to resolve '${uri.toString()}'`);
  }
}
