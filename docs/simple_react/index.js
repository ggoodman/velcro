//@ts-check
/** @type {import('../../packages/runtime')} */
// @ts-ignore
const Velcro = window.Velcro;

async function main() {
  const runtime = Velcro.createRuntime({
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
  });

  const importStart = Date.now();
  /** @type {[import('react'), import('react-dom')]} */
  const [React, ReactDom] = await Promise.all([runtime.import('react'), runtime.import('react-dom')]);
  const importEnd = Date.now();

  return new Promise(resolve =>
    ReactDom.render(
      React.createElement('span', null, `Imported in ${importEnd - importStart}ms`),
      document.getElementById('root'),
      () => {
        resolve(runtime);
      }
    )
  );
}

main().catch(console.error);
