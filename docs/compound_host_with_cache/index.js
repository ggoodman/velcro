// @ts-check
/** @type {import('../../packages/runtime')} */
// @ts-ignore
const Velcro = window.Velcro;

async function main() {
  const cacheStats = {
    hits: 0,
    misses: 0,
  };

  /**
   * Create a indexeddb cache with a predicate that skips in-memory files
   */
  const idbCache = Velcro.createCache('@velcro/runtime:cache', (_segment, key) => !key.startsWith('file:///'));

  /**
   * A wrapper around the indexeddb cache to keep some stats
   * @type {import('../../packages/runtime').Runtime.Cache}
   * */
  const cache = {
    delete(segment, id) {
      return idbCache.delete(segment, id);
    },
    async get(segment, id) {
      const result = await idbCache.get(segment, id);

      if (result) {
        cacheStats.hits++;
        return result;
      }
      cacheStats.misses++;
    },
    set(segment, id, value) {
      return idbCache.set(segment, id, value);
    },
  };

  /**
   * The initial set of files in the virtual file:// system. We create a simple index.js file
   * that exports a function that will render a react component to `#root`. The virtual filesystem
   * also holds a simple `package.json` that describes which version of react to use.
   */
  const initialFiles = {
    'index.js': `
'use strict';

const React = require('react');
const ReactDom = require('react-dom');

module.exports = (importStart, importEnd, cacheStats) =>
ReactDom.render(
  React.createElement(
    'span',
    null,
    \`Imported in \${importEnd - importStart}ms with \${(100 * cacheStats.hits) /
      (cacheStats.hits + cacheStats.misses)}% cache hit rate (\${cacheStats.hits} hits, \${cacheStats.misses} misses)\`
  ),
  document.getElementById('root')
);
    `.trim(),
    'package.json': JSON.stringify(
      {
        name: 'compound-host-with-cache',
        dependencies: {
          react: '^16.8.6',
          'react-dom': '^16.8.6',
        },
      },
      null,
      2
    ),
  };
  const resolverHost = new Velcro.ResolverHostCompound({
    'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
    'file:///': new Velcro.ResolverHostMemory(initialFiles),
  });
  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
    resolverHost,
  });

  const importStart = Date.now();
  const render = await runtime.import('file:///index.js');
  const importEnd = Date.now();

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);

  return;
}

main().catch(console.error);
