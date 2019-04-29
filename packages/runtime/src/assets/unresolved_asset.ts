import { Runtime } from '../runtime';

export class UnresolvedAsset implements Runtime.Asset {
  public readonly fileDependencies = new Set<string>();
  public readonly module: { id: string; exports: any } = { id: '', exports: {} };

  constructor(public readonly id: string = UnresolvedAsset.id) {}

  get exports() {
    return this.module.exports;
  }

  load() {
    const record: Runtime.LoadedModule = {
      cacheable: false,
      code: `throw new Error('Invariant violation: this should never be called');`,
      dependencies: [] as string[],
      type: Runtime.ModuleKind.CommonJs,
    };

    return Promise.resolve(record);
  }

  public static readonly id = 'velcro-internal:/unresolved';
}
