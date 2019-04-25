import { CommonJsAsset } from './commonjs';
import { Velcro } from '../velcro';
import { runLoaders } from '../webpack_loader_runner';

export class WebpackLoaderAsset extends CommonJsAsset {
  private fromId?: string;
  private resource: string;
  private unresolvedLoaders: ReadonlyArray<string>;

  constructor(id: string, fromId: string | undefined, host: Velcro.AssetHost, loaders: string[]) {
    const idWithLoaders = `!${loaders.concat(id).join('!')}`;

    super(idWithLoaders, host);

    this.fromId = fromId;
    this.resource = id;
    this.unresolvedLoaders = loaders;
  }

  async load() {
    const resolvedLoaders = await Promise.all(this.unresolvedLoaders.map(spec => this.host.resolve(spec, this.fromId)));
    const result = await runLoaders({
      assetHost: this.host,
      context: {},
      loaders: resolvedLoaders,
      resource: this.resource,
    });

    if (!result.result) {
      throw new Error(`Webpack loaders didn't produce a result for ${this.id}`);
    }

    const [codeVal] = result.result;
    const code = typeof codeVal === 'string' ? codeVal : this.host.decodeBuffer(codeVal);

    return CommonJsAsset.loadModule(this.id, code, this.host, result.cacheable);
  }
}

export function parseLoaderSpec(
  id: string,
  fromId?: string
): undefined | { loaders: string[]; prefix: string; query: string; resource: string } {
  const parentSpec = fromId ? parseLoaderSpec(fromId) : undefined;
  const matches = id.match(/^(!!?)?(.*?)(\?.*)?$/);

  if (!matches) {
    return;
  }

  const [, prefix = '', body = '', query = ''] = matches;
  const loaders = body.split('!');
  const resource = loaders.pop() || '';

  if (!prefix && !loaders.length) {
    return;
  }

  return {
    loaders,
    prefix,
    query,
    resource: parentSpec ? new URL(resource, parentSpec.resource).href : resource,
  };
}
