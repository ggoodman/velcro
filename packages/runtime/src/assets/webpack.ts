import { Runtime } from '../runtime';
import { runLoaders } from '../webpack_loader_runner';
import { CommonJsAsset } from './commonjs';

class HotModuleRuntime implements Runtime.HotModuleInterface {
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

export class WebpackLoaderAsset extends CommonJsAsset {
  public readonly module: Runtime.Asset['module'];
  public readonly fileDependencies = new Set<string>();
  public readonly resource: string;

  constructor(
    id: string,
    host: Runtime.AssetHost,
    readonly fromId: string | undefined,
    private readonly loaders: string[]
  ) {
    super(id, host);

    this.module = {
      exports: {},
      hot: new HotModuleRuntime(this, host),
    };
    this.resource = this.id.split('!').pop() as string;
  }

  get exports() {
    return this.module.exports;
  }

  async load() {
    const loaders = await Promise.all(this.loaders.map(loader => this.host.resolve(loader, this.fromId)));
    const loaderResult = await runLoaders({
      assetHost: this.host,
      loaders,
      resource: this.resource,
    });

    if (!loaderResult.result) {
      throw new Error(`No output was produced while running ${this.id} through the loaders ${this.loaders.join(', ')}`);
    }

    const [loaderResultCode] = loaderResult.result;
    const code = typeof loaderResultCode === 'string' ? loaderResultCode : this.host.decodeBuffer(loaderResultCode);
    const record = await CommonJsAsset.loadModule(loaders[0] || this.resource, code, this.host, loaderResult.cacheable);

    record.dependencies.push(...loaderResult.fileDependencies);

    return record;
  }
}
