import { IRuntime, ModuleFactory, RuntimeOptions } from './types';

export function createRuntime(Velcro: typeof import('.')): IRuntime;
export function createIncrementalPrelude(Velcro: typeof import('.')): IRuntime;
