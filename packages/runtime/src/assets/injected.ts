import { Runtime } from '../runtime';

export class InjectedJsAsset implements Runtime.Asset {
  public readonly module: { exports: any };

  constructor(public readonly id: string, exports: any) {
    this.module = { exports };
  }

  get exports() {
    return this.module.exports;
  }

  load() {
    const record: Runtime.LoadedModule = {
      cacheable: false,
      code: `throw new Error('Invariant violation: this should not be called');`,
      dependencies: [] as string[],
      type: Runtime.ModuleKind.CommonJs,
    };

    return Promise.resolve(record);
  }
}
