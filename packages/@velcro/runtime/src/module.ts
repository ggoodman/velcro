import type { Runtime } from './runtime';
import type { VelcroImportMap, VelcroRequire } from './types';

export class Module {
  public readonly require: VelcroRequire;
  public readonly module = { exports: {} };

  constructor(
    private readonly runtime: Runtime,
    readonly id: string,
    readonly importMap: VelcroImportMap
  ) {
    this.require = this.runtime.createRequire(this);
  }
}
