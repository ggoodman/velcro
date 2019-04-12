/** @type {import('../src')} */
const Velcro = window.Velcro;

const cache = {
  get(key) {
    const result = localStorage.getItem(key);

    if (result) {
      return JSON.parse(result);
    }
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

async function main() {
  /** @type {[import('react'), import('react-dom')]} */
  const [React, ReactDom] = await Promise.all([runtime.import('react'), runtime.import('react-dom')]);

  ReactDom.render(React.createElement('h1', null, 'Hello world'), document.getElementById('root'));
}

main().catch(console.error);
