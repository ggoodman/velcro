import { WebpackLoaderAsset } from './assets/webpack';
import { Runtime } from './runtime';

export class HotModuleRuntime implements Runtime.HotModuleInterface {
  constructor(readonly asset: WebpackLoaderAsset, readonly host: Runtime.AssetHost) {}

  accept(
    dependenciesOrCallback?: string | string[] | ((err: Error) => void),
    optionalCallback?: (err?: Error) => void
  ) {
    if (
      typeof dependenciesOrCallback === 'string' ||
      (dependenciesOrCallback && Array.isArray(dependenciesOrCallback))
    ) {
      // Accept updates for dependencies

      const dependencies =
        typeof dependenciesOrCallback === 'string' ? [dependenciesOrCallback] : dependenciesOrCallback;

      if (!dependencies.every(dependency => typeof dependency === 'string')) {
        throw new TypeError('The dependencies argument must be a non-empty string or array of non-empty strings');
      }

      if (optionalCallback && typeof optionalCallback !== 'function') {
        throw new TypeError('The callback argument, if specified, must be a function');
      }

      const callback = optionalCallback;

      console.log(
        `module[%s].hot.accept(%s, %s)`,
        this.asset.id,
        dependencies.join(', '),
        callback ? callback.toString() : undefined
      );
    } else {
      if (typeof dependenciesOrCallback !== 'function') {
        throw new TypeError('The errorHandler argument must be a function');
      }

      const errorHandler = dependenciesOrCallback;

      console.log(`module[%s].hot.accept(%s)`, this.asset.id, errorHandler.toString());
    }
  }

  addDisposeHandler() {
    console.log(`module[%s].hot.decline()`, this.asset.id);
  }
  decline() {
    console.log(`module[%s].hot.decline()`, this.asset.id);
  }
  dispose() {
    console.log(`module[%s].hot.dispose()`, this.asset.id);
  }
  removeDisposeHandler() {
    console.log(`module[%s].hot.dispose()`, this.asset.id);
  }
}
