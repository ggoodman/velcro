import { buildGraph, BuildGraphOptions, VelcroRuntime } from '@velcro/bundler';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';

const defaultExtensions: Resolver.Settings['extensions'] = ['.js', '.json'];
const defaultPackageMain: Resolver.Settings['packageMain'] = ['browser', 'main'];

export interface ExecuteOptions {
  cdn?: 'jsdelivr' | 'unpkg';
  dependencies?: { [key: string]: string };
  extensions?: Resolver.Settings['extensions'];
  external?: BuildGraphOptions['external'];
  injectModules?: { [id: string]: unknown };
  nodeEnv?: string;
  packageMain?: Resolver.Settings['packageMain'];
  readUrl: CdnStrategy.UrlContentFetcher;
  sourceMap?: boolean;
}

export async function execute(code: string, options: ExecuteOptions) {
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
  const build = chunk.buildForStaticRuntime({
    injectRuntime: true,
  });
  const codeWithStart = `${build.code}\n\nreturn Velcro.runtime;\n`;
  const runtimeCode = options.sourceMap
    ? `${codeWithStart}\n//# sourceMappingURL=${build.sourceMapDataUri}`
    : codeWithStart;
  const runtimeFn = new Function(runtimeCode) as () => VelcroRuntime;
  const velcro = runtimeFn();

  if (options.injectModules) {
    for (const id in options.injectModules) {
      velcro.inject(id, options.injectModules[id]);
    }
  }

  const result = velcro.require(entrypointUri.toString());

  return result;
}
