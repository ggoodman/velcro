import { GraphBuilder, GraphBuildError, VelcroRuntime } from '@velcro/bundler';
import { CancellationTokenSource } from '@velcro/common';
import { cssPlugin } from '@velcro/plugin-css';
import { sucrasePlugin } from '@velcro/plugin-sucrase';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';

const readUrl = (href: string) => fetch(href).then((res) => res.arrayBuffer());
const cdnStrategy = CdnStrategy.forJsDelivr(readUrl);
const memoryStrategy = new MemoryStrategy({});
const compoundStrategy = new CompoundStrategy({ strategies: [cdnStrategy, memoryStrategy] });
const resolver = new Resolver(compoundStrategy, {
  extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.mjs', '.cjs'],
  packageMain: ['browser', 'main'],
});
const graphBuilder = new GraphBuilder({
  resolver,
  nodeEnv: 'development',
  plugins: [cssPlugin(), sucrasePlugin({ transforms: ['imports', 'jsx', 'typescript'] })],
});

let nextBuildId = 0;
let nextScriptId = 0;
let queue: Promise<unknown> = Promise.resolve();
let timeout: null | number = null;
let tokenSource: CancellationTokenSource | null = null;

const findParentScriptTag = (node: Node) => {
  let nextNode: Node | null = node;

  while (nextNode) {
    if (nextNode instanceof HTMLScriptElement) {
      break;
    }

    nextNode = nextNode.parentNode;

    if (!nextNode) {
      throw new Error(`Unable to find the triggering script element`);
    }
  }

  return nextNode;
};

const onChange: MutationCallback = (records) => {
  if (tokenSource) {
    tokenSource.dispose(true);
    tokenSource = null;
  }

  if (timeout) {
    clearTimeout(timeout);
  }

  const scripts = records.map((record) => findParentScriptTag(record.target));

  for (const script of scripts) {
    const basePath = scriptTagsToBasePaths.get(script);

    if (basePath) {
      invalidate(memoryStrategy.uriForPath(`${basePath}/package.json`).toString());
      invalidate(memoryStrategy.uriForPath(`${basePath}/index.js`).toString());
    }
  }

  timeout = (setTimeout(() => {
    refresh(scripts);
    timeout = null;
  }, 500) as unknown) as number;
};

const observer = new MutationObserver(onChange);
const scriptTagsToBasePaths = new WeakMap<HTMLScriptElement, string>();

export function refresh(scripts: Iterable<HTMLScriptElement>) {
  if (tokenSource) {
    tokenSource.dispose(true);
  }

  tokenSource = new CancellationTokenSource();

  const buildId = nextBuildId++;
  const entrypointPaths: string[] = [];

  for (const script of scripts) {
    let basePath = scriptTagsToBasePaths.get(script);

    if (!basePath) {
      const scriptId = nextScriptId++;
      basePath = `/script/${scriptId}`;
      scriptTagsToBasePaths.set(script, basePath);
    }

    const rawDependencies = script.dataset.dependencies;
    const dependencies: Record<string, string> = {};

    // Convert dependencies encoded in data properties into a dependencies object
    if (rawDependencies) {
      for (const pair of rawDependencies.split(/\s*[,;]\s*/m)) {
        const [name, range] = pair.split(/\s*[@:]\s*/m);

        dependencies[name] = range;
      }
    }

    // Create a pseudo-package.json that will encode the dependencies
    // of this script and point to the script's entrypoint.
    memoryStrategy.addFile(
      `${basePath}/package.json`,
      JSON.stringify(
        {
          name: 'script',
          version: '0.0.0',
          main: 'index.js',
          dependencies,
        },
        null,
        2
      ),
      { overwrite: true }
    );

    memoryStrategy.addFile(`${basePath}/index.js`, script.text, { overwrite: true });
    entrypointPaths.push(`${basePath}/index.js`);

    observer.observe(script, {
      attributes: true,
      attributeFilter: ['data-dependencies', 'src'],
      characterData: true,
      subtree: true,
    });
  }

  queue = queue.then(() => {
    const unresolvedEntrypointUris = entrypointPaths.map((path) => memoryStrategy.uriForPath(path));
    const build = graphBuilder.build(unresolvedEntrypointUris, {
      token: tokenSource ? tokenSource.token : undefined,
    });

    return build.done.then(
      (graph) => {
        const [chunk] = graph.splitChunks();
        const output = chunk.buildForStaticRuntime({
          injectRuntime: buildId === 0,
        });

        const codeWithStart = `${output.code}\n\n${output.entrypoints
          .map((entrypoint) => `Velcro.runtime.require(${JSON.stringify(entrypoint.toString())});`)
          .join('\n')}\n`;
        const runtimeCode = `${codeWithStart}\n//# sourceMappingURL=${output.sourceMapDataUri}`;

        const scriptEl = document.createElement('script');
        scriptEl.setAttribute('type', 'text/javascript');
        scriptEl.text = runtimeCode;

        document.head.appendChild(scriptEl);
      },
      (err: GraphBuildError) => {
        console.error(err, 'Graph building failed');
      }
    );
  });

  return queue;
}

declare const Velcro: { runtime: VelcroRuntime };

function invalidate(href: string) {
  graphBuilder.invalidate(href);

  const runtime = Velcro.runtime;
  const queue = [href];
  const seen = new Set();

  while (queue.length) {
    const id = queue.shift()!;

    if (seen.has(id)) continue;
    seen.add(id);

    const module = runtime.modules[id];

    if (!module || module === runtime.root) continue;

    delete runtime.modules[id];

    const dependents = runtime.dependents[module.id];

    if (!Array.isArray(dependents)) continue;

    dependents.forEach((dependent) => {
      queue.push(dependent.id);
    });
  }
}
