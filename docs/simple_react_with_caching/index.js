/** @type {import('../../packages/runtime')} */
const Velcro = window.Velcro;

async function main() {
  const cacheStats = {
    hits: 0,
    misses: 0,
  };

  const cache = {
    get(segment, id) {
      const key = `${segment}:${id}`;
      const result = localStorage.getItem(key);

      if (result) {
        cacheStats.hits++;
        return JSON.parse(result);
      }
      cacheStats.misses++;
    },
    set(segment, id, value) {
      const key = `${segment}:${id}`;

      localStorage.setItem(key, JSON.stringify(value));
    },
  };
  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
  });

  const importStart = Date.now();
  /** @type {[import('react'), import('react-dom')]} */
  const [React, ReactDom] = await Promise.all([runtime.import('react'), runtime.import('react-dom')]);
  const importEnd = Date.now();

  return new Promise(resolve =>
    ReactDom.render(
      React.createElement(
        'span',
        null,
        `Imported in ${importEnd - importStart}ms with ${(100 * cacheStats.hits) /
          (cacheStats.hits + cacheStats.misses)}% cache hit rate (${cacheStats.hits} hits, ${cacheStats.misses} misses)`
      ),
      document.getElementById('root'),
      () => {
        resolve(runtime);
      }
    )
  );
}

main().catch(console.error);
