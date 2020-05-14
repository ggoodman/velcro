import type { ResolverContext } from './context';
import type { Uri } from './util/uri';

abstract class BaseError extends Error {
  readonly name = this.constructor.name;
}

export class BuildError extends BaseError {
  constructor(readonly errors: { err: Error; ctx: ResolverContext }[]) {
    super(
      `Build failed with errors:\n${errors
        .map(
          (err) =>
            `${err.err.message} at\n${err.ctx.path
              .map((op, i) => `${' '.repeat(i + 1)}${op}`)
              .join('\n')}`
        )
        .join('\n')}`
    );
  }
}

export class AmbiguousModuleError extends BaseError {}

export class CanceledError extends BaseError {}

export class EntryExcludedError extends BaseError {
  constructor(uri: { toString(): string }) {
    super(`Entry was excluded by current configuration '${uri.toString()}'`);
  }
}

export class EntryNotFoundError extends BaseError {
  constructor(uri: { toString(): string }) {
    super(`Unable to resolve '${uri.toString()}'`);
  }
}

export class DependencyNotFoundError extends EntryNotFoundError {
  constructor(spec: string, parentUri: { toString(): string }) {
    super(`The dependency '${spec}' of '${parentUri.toString()}' was not found`);
  }
}

export class NotResolvableError extends BaseError {}

export class ParseError extends BaseError {
  constructor(readonly uri: Uri, message: string) {
    super(`Parsing failed for '${uri.toString()}': ${message}`);
  }
}

export function isCanceledError(err: unknown): err is CanceledError {
  return err instanceof CanceledError || (err as any)?.name === 'CanceledError';
}
