/** @type {import('../src')} */
const Velcro = window.Velcro;

/**
 * @returns {Promise<ReturnType<import('../src').createRuntime>>}
 */
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
  const preLoadStart = Date.now();
  await Promise.all([runtime.preLoad('react'), runtime.preLoad('react-dom')]);
  const preLoadEnd = Date.now();
  console.timeEnd('preload');

  console.time('first-render');

  const importStart = Date.now();
  /** @type {[import('react'), import('react-dom')]} */
  const [React, ReactDom] = await Promise.all([runtime.import('react'), runtime.import('react-dom')]);
  const importEnd = Date.now();

  return new Promise(resolve =>
    ReactDom.render(
      React.createElement(
        'h1',
        null,
        `Preloaded in ${preLoadEnd - preLoadStart}ms -- imported in ${importEnd - importStart}ms`
      ),
      document.getElementById('root'),
      () => {
        console.timeEnd('first-render');
        console.log(
          'Finished rendering with %f.00% cache hit ratio',
          (100 * cacheStats.hits) / (cacheStats.hits + cacheStats.misses)
        );

        resolve(runtime);
      }
    )
  );
}

main()
  .then(async runtime => {
    await runtime.invalidate('process@0.11.0');
    return main();
  })
  .catch(console.error);
