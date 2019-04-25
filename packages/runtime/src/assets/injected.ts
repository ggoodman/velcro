import { Velcro } from '../velcro';

export class InjectedJsAsset implements Velcro.Asset {
  public readonly module: { exports: any };

  constructor(public readonly id: string, exports: any) {
    this.module = { exports };
  }

  get exports() {
    return this.module.exports;
  }

  load() {
    const record: Velcro.LoadedModule = {
      cacheable: false,
      code: `throw new Error('Invariant violation: this should not be called');`,
      dependencies: [] as string[],
      type: Velcro.ModuleKind.CommonJs,
    };

    return Promise.resolve(record);
  }
}
