//@ts-check
'use strict';

/**
 * @typedef IRuntime
 * @property {import('./types').VelcroRequire} require
 */

/**
 * @param {import('./types').VelcroStaticRuntime} velcro
 * @returns {IRuntime}
 */
export function createRuntime(velcro) {
  class Module {
    /**
     * @param {Runtime} runtime
     * @param {string} id
     * @param {import('./types').VelcroImportMap} importMap
     */
    constructor(runtime, id, importMap) {
      this.runtime = runtime;
      this.id = id;
      this.importMap = importMap;
      this.module = { exports: {} };
      this.require = runtime.createRequire(this);
    }
  }

  class Runtime {
    /**
     *
     * @param {import('./types').VelcroStaticRuntime} velcro
     */
    constructor(velcro) {
      /** @type {Required<import('./types').VelcroImportMap>} */
      this.importMap = { imports: {}, scopes: {} };
      this.defs = velcro.defs;
      /** @type {Record<string, Module | undefined>} */
      this.modules = Object.create(null);
      this.root = new Module(this, 'velcro://root', {});
      this.require = this.createRequire(this.root);
    }

    /**
     *
     * @param {Module} fromModule
     */
    createRequire(fromModule) {
      const runtime = this;

      /**
       *
       * @param {string} spec
       */
      function require(spec) {
        let module = runtime.modules[spec];

        if (!module) {
          const id = runtime.resolveSpecAgainstImportMap(spec, fromModule);

          const moduleDefinition = runtime.defs[id];

          if (!moduleDefinition) {
            throw new Error(`Unable to locate module '${id}' from '${fromModule.id}`);
          }

          const [factory, importMap] = moduleDefinition;

          module = new Module(runtime, id, importMap);
          runtime.modules[id] = module;

          const specParts = id.split('/');
          const __filename = specParts.pop() || spec;
          const __dirname = specParts.join('/');

          factory.call(
            module.module.exports,
            module.module,
            module.module.exports,
            module.require.bind(module),
            __dirname,
            __filename
          );
        }

        return module.module.exports;
      }

      /**
       *
       * @param {string} _spec
       */
      function resolve(_spec) {
        return '';
      }

      return Object.assign(require, {
        resolve,
      });
    }

    /**
     * Inject a pre-existing module
     *
     * @template T
     * @param {string} id Identifier of module
     * @param {T} exports Value that represents the exported interface of the module
     */
    inject(id, exports) {
      const module = new Module(this, id, Object.create(null));

      module.module.exports = exports;

      this.modules[id] = module;
    }

    /**
     *
     * @param {string} spec
     * @param {Module} module
     * @private
     */
    resolveSpecAgainstImportMap(spec, module) {
      const importMap = module.importMap;

      if (!importMap.scopes) {
        return spec;
      }

      const scopesForId = importMap.scopes[module.id];

      if (!scopesForId) {
        return spec;
      }

      const mappedId = scopesForId[spec];

      if (mappedId) {
        return mappedId;
      }

      return spec;
    }
  }

  const runtime = new Runtime(velcro);

  return runtime;
}
