abstract class BaseError extends Error {
  readonly name = this.constructor.name;
}

export class GraphBuildError extends BaseError {
  constructor(readonly errors: Error[]) {
    super(
      `Graph building failed with errors:\n${errors.map((err) => `  ${err.message}`).join('\n')}`
    );
  }
}
