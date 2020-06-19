import { GraphBuilder, GraphBuildError } from '@velcro/bundler';
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

let nextScriptId = 0;
let queue: Promise<unknown> = Promise.resolve();
let timeout: null | number = null;

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
  if (timeout) {
    clearTimeout(timeout);
  }

  timeout = (setTimeout(() => {
    refresh(records.map((record) => findParentScriptTag(record.target)));
    timeout = null;
  }, 1000) as unknown) as number;
};

const observer = new MutationObserver(onChange);
const scriptTagsToBasePaths = new WeakMap<HTMLScriptElement, string>();

export function refresh(scripts: Iterable<HTMLScriptElement>) {
  const entrypointPaths: string[] = [];
  const invalidations: string[] = [];

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
      for (const pair of rawDependencies.split(/\s*,\s*/m)) {
        const [name, range] = pair.split(/\s*:\s*/m);

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
    graphBuilder.invalidate(memoryStrategy.uriForPath(`${basePath}/package.json`));
    invalidations.push(memoryStrategy.uriForPath(`${basePath}/package.json`).toString());

    if (script.src) {
      // We need to load the code over http so we'll add the operation to the
      // queue.
      queue = queue.then(() =>
        fetch(script.src)
          .then((res) => res.text())
          .then((code) => {
            memoryStrategy.addFile(`${basePath}/index.js`, code, { overwrite: true });
            graphBuilder.invalidate(memoryStrategy.uriForPath(`${basePath}/index.js`));
            invalidations.push(memoryStrategy.uriForPath(`${basePath}/index.js`).toString());
          })
          .catch((err) => {
            const event = new CustomEvent('error', { detail: { error: err } });
            script.dispatchEvent(event);
            console.error('Error reading the code at %s:', script.src, err);
            return '';
          })
      );
    } else {
      memoryStrategy.addFile(`${basePath}/index.js`, script.text, { overwrite: true });
      graphBuilder.invalidate(memoryStrategy.uriForPath(`${basePath}/index.js`));
      invalidations.push(memoryStrategy.uriForPath(`${basePath}/index.js`).toString());
    }

    entrypointPaths.push(`${basePath}/index.js`);

    observer.observe(script, {
      attributes: true,
      attributeFilter: ['data-dependencies', 'src'],
      characterData: true,
      subtree: true,
    });
  }

  queue = queue.then(() => {
    const entrypointUris = entrypointPaths.map((path) => memoryStrategy.uriForPath(path));

    return graphBuilder.buildGraph(entrypointUris).then(
      (graph) => {
        const [chunk] = graph.splitChunks();
        const output = chunk.buildForStaticRuntime({
          injectRuntime: true,
        });
        const codeWithStart = `${output.code}\n\n${entrypointUris
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
