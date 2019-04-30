import { Runtime } from './runtime';

export abstract class Asset implements Runtime.Asset {
  public readonly module = { exports: {} };

  constructor(readonly id: string) {}

  get exports() {
    return this.module.exports;
  }

  abstract load(): Promise<Runtime.LoadedModule>;
}
