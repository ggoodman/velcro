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
  const resolverHost = new Velcro.ResolverHostCompound({
    'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
    'memory:/': new Velcro.ResolverHostMemory(initialFiles),
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

  const importStart = Date.now();
  const { render } = await runtime.import('memory:/index.jsx');
  const importEnd = Date.now();

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

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);

  return;
}

main().catch(console.error);
