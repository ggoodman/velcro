export interface Diagnostic {
  message: string;
  start?: { lineNumber: number; column: number };
  end?: { lineNumber: number; column: number };
  href?: string;
}

export class ExtendableError extends Error {
  constructor(message?: string) {
    super(message);

    this.name = this.constructor.name;
  }
}

export class InvariantError extends ExtendableError {}

export class NotSupportedError extends ExtendableError {}

export class TimeoutError extends ExtendableError {}

export class TranspileError extends ExtendableError {
  constructor(message: string, readonly diagnostics: Diagnostic[]) {
    super(message);
  }
}
