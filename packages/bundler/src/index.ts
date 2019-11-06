export { CancellationToken, CancellationTokenSource } from 'ts-primitives';

export * from './asset';
export * from './bundler';
export * from './error';
export {
  DeferredExecutionManifest,
  DeferredExecutionModuleRecord,
  ImmediateExecutionManifest,
  ImmediateExecutionModuleRecord,
} from './types';

export { getSourceMappingUrl } from './util';

import { Base64 } from 'js-base64';

export const base64 = {
  decode: Base64.decode,
  encode: Base64.encode,
};

import { IModule, IRuntime } from './types';

export type Module = IModule;
export type Runtime = IRuntime;
