// @ts-check
/** @type {import('../../packages/runtime')} */
// @ts-ignore
const Velcro = window.Velcro;

/**
 *
 * @param {import('../../packages/runtime').Runtime} runtime
 * @param {import('../../packages/runtime').ResolverHostMemory} memoryHost
 * @param {{ hits: number, misses: number }} cacheStats
 */
async function demo(runtime, memoryHost, cacheStats) {
  const importStart = Date.now();
  const { render } = await runtime.import(memoryHost.urlFromPath('/index.jsx'));
  const importEnd = Date.now();

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);
}

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
    'index.css': `
.stat {
  color: red;
  font-weight: bold;
}
    `.trim(),
    'index.jsx': `
'use strict';

import React from 'react';
import ReactDom from 'react-dom';

import Styles from './index.css';

const Stats = (props) =>
    <>
      Imported in
      {' '}
      <strong className={Styles.stat}>{props.importEnd - props.importStart}ms</strong>
      {' '}
      with
      {' '}
      <strong className={Styles.stat}>{Math.round(1000 * props.cacheStats.hits / (props.cacheStats.hits + props.cacheStats.misses)) / 10}%</strong>
      {' '}
      hit rate ({props.cacheStats.hits} hits, {props.cacheStats.misses} misses).
    </>;

export const render = (importStart, importEnd, cacheStats) =>
ReactDom.render(
  <Stats {...{importStart, importEnd, cacheStats}} />,
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
        devDependencies: {
          '@sucrase/webpack-loader': '^2.0.0',
          'css-loader': '^2.1.1',
          'style-loader': '^0.23.1',
          sucrase: '^3.10.1',
        },
      },
      null,
      2
    ),
  };
  const memoryHost = new Velcro.ResolverHostMemory(initialFiles, 'compound_host_with_css_loader');
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
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader', options: { modules: true } }],
      },
      {
        test: /\.jsx$/,
        use: [{ loader: '@sucrase/webpack-loader', options: { transforms: ['imports', 'jsx'] } }],
      },
    ],
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

  return demo(runtime, memoryHost, cacheStats);
}

main().catch(console.error);
