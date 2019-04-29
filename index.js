//@ts-check

/** @type {import('./packages/runtime')} */
// @ts-ignore
const Velcro = window.Velcro;

Velcro.Runtime.debug = true;

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
 * @type {import('./packages/runtime').Runtime.Cache}
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

const resolverHost = new Velcro.ResolverHostCompound({
  'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
  'memory:/': new Velcro.ResolverHostMemory({
    'package.json': JSON.stringify({
      name: 'test',
      dependencies: {
        bootstrap: '4.3',
        react: '16',
        'react-dom': '16',
      },
      devDependencies: {
        'css-loader': '*',
        'style-loader': '*',
      },
    }),
    'index.js': `
const React = require("react");
const ReactDOM = require("react-dom");

require('bootstrap/dist/css/bootstrap.css');

class Hello extends React.Component {
  render() {
    const latency = Date.now() - this.props.start;
    const rate =
      Math.round(
        (10000 * this.props.cacheStats.hits) /
          (this.props.cacheStats.hits + this.props.cacheStats.misses)
      ) / 100;

    return React.createElement(
      "pre",
      null,
      React.createElement(
        "code",
        null,
        \`Imported react@\${this.props.version} in \${latency}ms with \${rate}% cache hit rate (\${this.props.cacheStats.hits} hits, \${this.props.cacheStats.misses} misses)\`
      )
    );
  }
}

module.exports = (cacheStats, start) =>
  ReactDOM.render(
    React.createElement(
      Hello,
      { cacheStats, start, version: React.version },
      null
    ),
    document.getElementById("root")
  );
    `,
  }),
});

var runtime = Velcro.createRuntime({
  resolverHost,
  cache,
  enableSourceMaps: true,
  injectGlobal: Velcro.injectGlobalFromUnpkg,
  resolveBareModule: Velcro.resolveBareModuleToUnpkg,
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

const start = Date.now();

runtime.import('memory:/').then(async render => {
  render(cacheStats, start);

  await runtime
    .invalidate('bootstrap/dist/css/bootstrap.css', 'memory:/index.js')
    .then(() => runtime.import('memory:/'))
    .then(render => render(cacheStats, start));
}, console.error);
