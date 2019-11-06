import { IRuntime, ModuleFactory, RuntimeOptions } from './types';

export function createRuntime(Velcro: typeof import('.')): IRuntime;
