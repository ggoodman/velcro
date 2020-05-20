import { buildGraph, BuildGraphOptions, VelcroRuntime } from '@velcro/bundler';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';

const defaultExtensions: Resolver.Settings['extensions'] = ['.js', '.json'];
const defaultPackageMain: Resolver.Settings['packageMain'] = ['browser', 'main'];

export interface BuildOptions {
  cdn?: 'jsdelivr' | 'unpkg';
  dependencies?: { [key: string]: string };
  extensions?: Resolver.Settings['extensions'];
  external?: BuildGraphOptions['external'];
  nodeEnv?: string;
  packageMain?: Resolver.Settings['packageMain'];
  readUrl: CdnStrategy.UrlContentFetcher;
  sourceMap?: boolean;
}

export interface ExecuteOptions extends BuildOptions {
  injectModules?: { [id: string]: unknown };
}

export async function build(code: string, options: BuildOptions) {
  const entrypointPath = 'index.js';
  const cdnStrategy =
    options.cdn === 'unpkg'
      ? CdnStrategy.forUnpkg(options.readUrl)
      : CdnStrategy.forJsDelivr(options.readUrl);
  const memoryStrategy = new MemoryStrategy({
    [entrypointPath]: code,
    ['package.json']: JSON.stringify({
      name: '@@velcro/execute',
      version: '0.0.0',
      dependencies: options.dependencies,
    }),
  });
  const entrypointUri = memoryStrategy.uriForPath(entrypointPath);
  const compoundStrategy = new CompoundStrategy({ strategies: [cdnStrategy, memoryStrategy] });
  const resolver = new Resolver(compoundStrategy, {
    extensions: options.extensions || defaultExtensions,
    packageMain: options.packageMain || defaultPackageMain,
  });

  const graph = await buildGraph({
    external: options.external,
    entrypoints: [entrypointUri],
    resolver,
    nodeEnv: options.nodeEnv || 'development',
  });
  const [chunk] = graph.splitChunks();
  const output = chunk.buildForStaticRuntime({
    injectRuntime: true,
  });

  return { entrypointUri, output };
}

export async function execute<T = unknown>(code: string, options: ExecuteOptions) {
  const { entrypointUri, output } = await build(code, options);
  const codeWithStart = `${output.code}\n\nreturn Velcro.runtime;\n`;
  const runtimeCode = options.sourceMap
    ? `${codeWithStart}\n//# sourceMappingURL=${output.sourceMapDataUri}`
    : codeWithStart;
  const runtimeFn = new Function(runtimeCode) as () => VelcroRuntime;
  const velcro = runtimeFn();

  if (options.injectModules) {
    for (const id in options.injectModules) {
      velcro.inject(id, options.injectModules[id]);
    }
  }

  const result = velcro.require(entrypointUri.toString());

  return result as T;
}
