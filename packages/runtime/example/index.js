/** @type {import('../src')} */
const Velcro = window.Velcro;

async function main() {
  const cacheStats = {
    hits: 0,
    misses: 0,
  };

  const cache = {
    get(key) {
      const result = localStorage.getItem(key);

      if (result) {
        cacheStats.hits++;
        return JSON.parse(result);
      }
      cacheStats.misses++;
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
  });

  console.time('preload');
  await Promise.all([runtime.load('react'), runtime.load('react-dom')]);
  console.timeEnd('preload');

  await delay(5000);

  console.time('first-render');

  /** @type {[import('react'), import('react-dom')]} */
  const [React, ReactDom] = await Promise.all([runtime.import('react'), runtime.import('react-dom')]);

  ReactDom.render(React.createElement('h1', null, 'Hello world'), document.getElementById('root'), () => {
    console.timeEnd('first-render');
    console.log(
      'Finished rendering with %f.00% cache hit ratio',
      (100 * cacheStats.hits) / (cacheStats.hits + cacheStats.misses)
    );
  });
}

function delay(n) {
  return new Promise(resolve => setTimeout(resolve, n));
}

main().catch(console.error);
