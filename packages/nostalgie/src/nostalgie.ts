import { buildGraph, GraphBuildError } from '@velcro/bundler';
import { cssPlugin } from '@velcro/plugin-css';
import { sucrasePlugin } from '@velcro/plugin-sucrase';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';

const readUrl = (href: string) => fetch(href).then((res) => res.arrayBuffer());

let queue: Promise<unknown> = Promise.resolve();
let timeout: null | number = null;

const onChange: MutationCallback = (records) => {
  if (timeout) {
    clearTimeout(timeout);
  }

  timeout = (setTimeout(() => {
    refresh(records.map((record) => record.target as HTMLScriptElement));
    timeout = null;
  }, 1000) as unknown) as number;
};

const observer = new MutationObserver(onChange);

export function refresh(scripts: Iterable<HTMLScriptElement>) {
  const entrypointPaths: string[] = [];
  const files: Record<string, string> = {};

  let idx = 0;

  for (const script of scripts) {
    const scriptId = idx++;
    const basePath = `/script/${scriptId}`;
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
    files[`${basePath}/package.json`] = JSON.stringify(
      {
        name: `script${scriptId}`,
        version: '0.0.0',
        main: 'index.js',
        dependencies,
      },
      null,
      2
    );

    if (script.src) {
      // We need to load the code over http so we'll add the operation to the
      // queue.
      queue = queue.then(() =>
        fetch(script.src)
          .then((res) => res.text())
          .then((code) => (files[`${basePath}/index.js`] = code))
          .catch((err) => {
            const event = new CustomEvent('error', { detail: { error: err } });
            script.dispatchEvent(event);
            console.error('Error reading the code at %s:', script.src, err);
            return '';
          })
      );
    } else {
      files[`${basePath}/index.js`] = script.text;
    }

    entrypointPaths.push(`${basePath}/index.js`);

    observer.observe(script, { childList: true });
  }

  const cdnStrategy = CdnStrategy.forJsDelivr(readUrl);
  const memoryStrategy = new MemoryStrategy(files);
  const compoundStrategy = new CompoundStrategy({ strategies: [cdnStrategy, memoryStrategy] });
  const resolver = new Resolver(compoundStrategy, {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.mjs', '.cjs'],
    packageMain: ['browser', 'main'],
  });

  queue = queue.then(() => {
    const entrypointUris = entrypointPaths.map((path) => memoryStrategy.uriForPath(path));

    return buildGraph({
      entrypoints: entrypointUris,
      resolver,
      nodeEnv: 'development',
      plugins: [cssPlugin(), sucrasePlugin({ transforms: ['imports', 'jsx', 'typescript'] })],
    }).then(
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
