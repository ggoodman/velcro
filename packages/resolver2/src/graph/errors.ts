import { ResolverContext } from '../context';

abstract class BaseError extends Error {
  readonly name = this.constructor.name;
}

export class GraphBuildError extends BaseError {
  constructor(readonly errors: { err: Error; ctx: ResolverContext }[]) {
    super(
      `Graph building failed with errors:\n${errors
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
