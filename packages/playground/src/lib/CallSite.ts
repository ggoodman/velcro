export interface CallSiteOptions {
  columnNumber?: number;
  evalOrigin?: string;
  fileName?: string;
  functionName?: string;
  isConstructor: boolean;
  isEval: boolean;
  isInternal?: boolean;
  isNative: boolean;
  isToplevel: boolean;
  methodName?: string;
  lineNumber?: number;
  typeName?: string;
}

export class CallSite {
  constructor(private readonly options: CallSiteOptions) {}

  getColumnNumber() {
    return this.options.columnNumber;
  }

  getEvalOrigin() {
    return this.options.evalOrigin || '(EVALORIGIN)';
  }

  getMethodName() {
    return this.options.methodName;
  }

  getFunctionName() {
    return this.options.functionName;
  }

  getLineNumber() {
    return this.options.lineNumber;
  }

  getFileName() {
    return this.options.fileName;
  }

  getTypeName() {
    return this.options.typeName;
  }

  isConstructor() {
    return this.options.isConstructor;
  }

  isEval() {
    return this.options.isEval;
  }

  isInternal() {
    return !!this.options.isInternal;
  }

  isNative() {
    return this.options.isNative;
  }

  isToplevel() {
    return this.options.isToplevel;
  }

  // This is copied almost verbatim from the V8 source code at
  // https://code.google.com/p/v8/source/browse/trunk/src/messages.js. The
  // implementation of wrapCallSite() used to just forward to the actual source
  // code of CallSite.prototype.toString but unfortunately a new release of V8
  // did something to the prototype chain and broke the shim. The only fix I
  // could find was copy/paste.
  toString() {
    let fileName: string | undefined = undefined;
    let fileLocation = '';
    if (this.isNative()) {
      fileLocation = 'native';
    } else {
      fileName = this.getFileName();
      if (!fileName && this.isEval()) {
        fileLocation = this.getEvalOrigin();
        fileLocation += ', '; // Expecting source position to follow.
      }

      if (fileName) {
        fileLocation += fileName;
      } else {
        // Source code does not originate from a file and is not native, but we
        // can still get the source position inside the source string, e.g. in
        // an eval string.
        fileLocation += '<anonymous>';
      }
      const lineNumber = this.getLineNumber();
      if (lineNumber !== undefined) {
        fileLocation += ':' + lineNumber;
        const columnNumber = this.getColumnNumber();
        if (columnNumber !== undefined) {
          fileLocation += ':' + columnNumber;
        }
      }
    }

    let line = '';
    const functionName = this.getFunctionName();
    let addSuffix = true;
    const isConstructor = this.isConstructor();
    const isMethodCall = !(this.isToplevel() || isConstructor);

    if (isMethodCall) {
      let typeName = this.getTypeName();
      // Fixes shim to be backward compatable with Node v0 to v4
      if (typeName === '[object Object]') {
        typeName = 'null';
      }
      const methodName = this.getMethodName();
      if (functionName) {
        if (typeName && functionName.indexOf(typeName) !== 0) {
          line += typeName + '.';
        }
        line += functionName;
        if (methodName && functionName.indexOf('.' + methodName) !== functionName.length - methodName.length - 1) {
          line += ' [as ' + methodName + ']';
        }
      } else {
        line += typeName + '.' + (methodName || '<anonymous>');
      }
    } else if (isConstructor) {
      line += 'new ' + (functionName || '<anonymous>');
    } else if (functionName) {
      line += functionName;
    } else {
      line += fileLocation;
      addSuffix = false;
    }
    if (addSuffix) {
      line += ' (' + fileLocation + ')';
    }

    return line;
  }

  with(options: Partial<CallSiteOptions>) {
    return new CallSite({
      ...this.options,
      ...options,
    });
  }

  // This function is part of the V8 stack trace API, for more info see:
  // https://v8.dev/docs/stack-trace-api
  static prepareStackTrace<T extends Error>(error: T, stack: CallSite[]) {
    const name = error.name || 'Error';
    const message = error.message || '';
    const errorString = name + ': ' + message;

    return [
      { isInternal: false, text: errorString },
      ...stack.map(frame => ({ isInternal: frame.isInternal(), text: `    at ${frame.toString()}` })),
    ];
  }
}
