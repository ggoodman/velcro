import { Runtime } from '../runtime';

export class UnresolvedAsset implements Runtime.Asset {
  public readonly module: { exports: any } = { exports: {} };

  constructor(public readonly id: string, fromId?: string) {
    if (typeof Proxy === 'function') {
      const proxyHandler: ProxyHandler<any> = {
        apply(_target, _thisArg, argArray) {
          throw new Error(
            `Attempting to invoke the moduleExports of a module that could not be resolved: ${id}${
              fromId ? ` from ${fromId}` : ''
            } with arguments: ${argArray.join(', ')}`
          );
        },
        construct(_target, argArray, _newTarget) {
          throw new Error(
            `Attempting to construct the exports of a module that could not be resolved: ${id}${
              fromId ? ` from ${fromId}` : ''
            } with arguments: ${argArray.join(', ')}`
          );
        },
      };

      this.module.exports = new Proxy(this.module.exports, proxyHandler);
    }
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
