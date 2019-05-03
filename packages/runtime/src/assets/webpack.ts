import { Runtime } from '../runtime';
import { runLoaders } from '../webpack_loader_runner';
import { CommonJsAsset } from './commonjs';
import { HotModuleRuntime } from '../hmr';
import { util } from '@velcro/resolver';

export class WebpackLoaderAsset extends CommonJsAsset {
  public readonly module: Runtime.Asset['module'];
  public readonly fileDependencies = new Set<string>();
  public readonly resource: string;

  constructor(
    id: string,
    host: Runtime.AssetHost,
    readonly fromId: string | undefined,
    private readonly loaders: Array<{ loader: string; options: any }>
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
    // const packageJson = await this.host.readParentPackageJson(this.resource);

    // const rootContext = packageJson ? util.dirname(packageJson.href) : util.dirname(this.resource);
    // const loaders = await Promise.all(this.loaders.map(loader => this.host.resolve(loader, this.fromId)));
    const loaderResult = await runLoaders({
      context: {
        emitError: console.error,
        emitWarning: console.warn,
        rootContext: util.dirname(this.fromId || this.resource),
        // resource: this.resource,
        // resourcePath: this.resource,
        webpack: false,
      },
      assetHost: this.host,
      loaders: this.loaders,
      resource: this.resource,
    });

    if (!loaderResult.result) {
      throw new Error(`No output was produced while running ${this.id} through the loaders ${this.loaders.join(', ')}`);
    }

    const [loaderResultCode] = loaderResult.result;
    const code = typeof loaderResultCode === 'string' ? loaderResultCode : this.host.decodeBuffer(loaderResultCode);
    const record = await CommonJsAsset.loadModule(this.resource, code, this.host, loaderResult.cacheable);

    record.fileDependencies.push(...loaderResult.fileDependencies);

    return record;
  }
}
