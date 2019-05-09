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
    'stats.html': `
<script>
  export let importStart;
  export let importEnd;
  export let cacheStats = { hits: 0, misses: 0 };

  $: latency = importEnd - importStart;
  $: hitRatio = Math.round(1000 * cacheStats.hits / (cacheStats.hits + cacheStats.misses)) / 10;
</script>
<style>
  .stat {
    color: red;
    font-weight: bold;
  }
</style>

Imported in <strong class="stat">{latency}ms</strong> with <strong class="stat">{hitRatio}%</strong> hit rate ({cacheStats.hits} hits, {cacheStats.misses} misses).
    `.trim(),
    'index.js': `
'use strict';

const Stats = require('./stats.html').default;

module.exports = (importStart, importEnd, cacheStats) => {
  const target = document.getElementById('root');

  // Empty the target
  target.innerHTML = '';

  const widget = new Stats({
    props: { importStart, importEnd, cacheStats },
    target,
  })
}
    `.trim(),
    'package.json': JSON.stringify(
      {
        name: 'velcro-svelte',
        devDependencies: {
          '@sucrase/webpack-loader': '^2.0.0',
          sucrase: '^3.10.1',
          svelte: '^3.2.2',
          'svelte-loader': '^2.13.3',
        },
      },
      null,
      2
    ),
  };
  const memoryHost = new Velcro.ResolverHostMemory(initialFiles, 'svelte-loader');
  const resolverHost = new Velcro.ResolverHostCompound({
    'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
    [memoryHost.urlFromPath('/').href]: memoryHost,
  });
  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
    resolverHost,
    rules: [
      {
        test: /\.html$/,
        use: [{ loader: '@sucrase/webpack-loader', options: { transforms: ['imports'] } }, { loader: 'svelte-loader' }],
      },
    ],
  });

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

  const importStart = Date.now();
  const render = await runtime.import(memoryHost.urlFromPath('index.js'));
  const importEnd = Date.now();

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);

  return;
}

main().catch(console.error);
