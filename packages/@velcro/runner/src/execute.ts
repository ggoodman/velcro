import { ChunkOutput, GraphBuilder, Plugin, VelcroRuntime } from '@velcro/bundler';
import { Uri } from '@velcro/common';
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
  external?: GraphBuilder.Options['external'];
  nodeEnv?: string;
  plugins?: Plugin[];
  packageMain?: Resolver.Settings['packageMain'];
  readUrl: CdnStrategy.UrlContentFetcher;
}

export interface ExecuteOptions extends BuildOptions {
  sourceMap?: boolean;
  injectModules?: { [id: string]: unknown };
}

export async function build(
  code: string,
  options: BuildOptions
): Promise<{ entrypoints: readonly Uri[]; output: ChunkOutput }> {
  const entrypointPath = `index.js`;
  const cdnStrategy =
    options.cdn === 'unpkg'
      ? CdnStrategy.forUnpkg(options.readUrl)
      : CdnStrategy.forJsDelivr(options.readUrl);
  const memoryStrategy = new MemoryStrategy(
    {
      [entrypointPath]: code,
      ['package.json']: JSON.stringify({
        name: '@@velcro/execute',
        version: '0.0.0',
        dependencies: options.dependencies,
      }),
    },
    Uri.parse(`velcro://${Math.random().toString(16).slice(2)}/`)
  );
  const entrypointUri = memoryStrategy.uriForPath(entrypointPath);
  const compoundStrategy = new CompoundStrategy({ strategies: [cdnStrategy, memoryStrategy] });
  const resolver = new Resolver(compoundStrategy, {
    extensions: options.extensions || defaultExtensions,
    packageMain: options.packageMain || defaultPackageMain,
  });
  const graphBuilder = new GraphBuilder({
    external: options.external,
    resolver,
    nodeEnv: options.nodeEnv || 'development',
    plugins: options.plugins,
  });
  const build = graphBuilder.build([entrypointUri]);
  const graph = await build.done;
  const [chunk] = graph.splitChunks();
  const output = chunk.buildForStaticRuntime({
    injectRuntime: true,
  });

  return { entrypoints: output.entrypoints, output };
}

export async function execute<T = unknown>(code: string, options: ExecuteOptions): Promise<T> {
  if (options.injectModules) {
    const injectedModuleSpecs = new Set(Object.keys(options.injectModules));
    const optionsExternal = options.external;
    const isExternal: GraphBuilder.Options['external'] = (dependency, fromSourceModule) => {
      if (injectedModuleSpecs.has(dependency.spec)) {
        return true;
      }

      return typeof optionsExternal === 'function'
        ? optionsExternal(dependency, fromSourceModule)
        : false;
    };

    options.external = isExternal;
  }

  const { entrypoints, output } = await build(code, options);
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

  const result = velcro.require(entrypoints[0].toString());

  return result as T;
}
