declare module 'stacktrace-gps' {
  import { SourceMapConsumer } from 'source-map';
  import { StackFrameOptions } from 'stackframe';

  export interface StackTraceGPSOptions {
    sourceCache?: Record<string, string>;
    sourceMapConsumerCache?: Record<string, SourceMapConsumer>;
    offline?: boolean;
    ajax?: (url: string) => Promise<string>;
    atob?: (base64: string) => string;
  }

  export default class StackTraceGPS {
    constructor(options?: StackTraceGPSOptions);

    findFunctionName(stackFrame: StackFrameOptions): Promise<StackFrame>;
    pinpoint(stackFrame: StackFrameOptions): Promise<StackFrame>;
    getMappedLocation(stackFrame: StackFrameOptions): Promise<StackFrame>;
  }
}
