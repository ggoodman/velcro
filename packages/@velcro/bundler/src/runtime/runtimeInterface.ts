import type { VelcroRequire } from './types';

export interface VelcroRuntime {
  readonly dependents: Record<string, VelcroModuleInstance[] | undefined>;
  readonly modules: Record<string, VelcroModuleInstance | undefined>;
  readonly root: VelcroModuleInstance;

  createRequire(fromModule: VelcroModuleInstance): VelcroRequire;
  inject(id: string, exports: unknown): VelcroModuleInstance;
  invalidate(ids: string[]): void;
  require: VelcroRequire;
}

export interface VelcroModuleInstance {
  readonly id: string;
  readonly runtime: VelcroRuntime;
  readonly module: { exports: {} };
  readonly require: VelcroRequire;
}
