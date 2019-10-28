declare module 'react-error-overlay' {
  export type EditorHandler = (errorLoc: ErrorLocation) => void;
  export interface ErrorLocation {
    fileName: string;
    lineNumber: number;
    colNumber?: number;
  }
  export interface RuntimeReportingOption {
    onError: () => void;
    filename?: string;
  }

  export function setEditorHandler(handler: EditorHandler | null): void;

  export function dismissBuildError(): void;
  export function reportBuildError(error: string): void;

  export function dismissRuntimeError(): void;
  export function reportRuntimeError(error: Error, options?: RuntimeReportingOption): void;
  export function startReportingRuntimeErrors(options: RuntimeReportingOption): void;
  export function stopReportingRuntimeErrors(): void;
}
