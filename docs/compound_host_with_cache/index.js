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
  const idbCache = Velcro.createCache('@velcro/runtime:cache', (_segment, key) => !key.startsWith('memory:/'));

  /**
   * A wrapper around the indexeddb cache to keep some stats
   * @type {import('../../packages/runtime').Runtime.Cache}
   * */
  const cache = {
    ...idbCache,
    async get(segment, id) {
      const result = await idbCache.get(segment, id);

      if (result) {
        cacheStats.hits++;
        return result;
      }
      cacheStats.misses++;
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

  document.getElementById('cache_clear').addEventListener('click', () => {
    const msgEl = document.getElementById('cache_msg');

    Promise.resolve(cache.clear()).then(
      () => {
        msgEl.innerText = 'Cache cleared';
      },
      err => {
        msgEl.innerText = `Error clearing cache: ${err.message}`;
      }
    );
  });

  for (const pathname in initialFiles) {
    const wrapperEl = document.createElement('div');
    const pathnameEl = document.createElement('h4');

    pathnameEl.innerText = pathname;

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const codeText = document.createTextNode(initialFiles[pathname]);

    code.className = `language-${Velcro.util.extname(pathname).slice(1)}`;

    code.appendChild(codeText);
    pre.appendChild(code);
    wrapperEl.appendChild(pathnameEl);
    wrapperEl.appendChild(pre);

    document.getElementById('files').appendChild(wrapperEl);
  }

  const memoryHost = new Velcro.ResolverHostMemory(initialFiles, 'compound_host_with_cache');
  const resolverHost = new Velcro.ResolverHostCompound({
    'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
    [memoryHost.urlFromPath('/').href]: memoryHost,
  });
  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
    resolverHost,
  });

  const importStart = Date.now();
  const render = await runtime.import(memoryHost.urlFromPath('/index.js'));
  const importEnd = Date.now();

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);

  return;
}

main().catch(console.error);
