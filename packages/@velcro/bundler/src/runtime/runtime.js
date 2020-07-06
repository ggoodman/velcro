//@ts-check
'use strict';

/**
 * @param {import('./types').VelcroStaticRuntime} velcro
 * @returns {import('./runtimeInterface').VelcroRuntime}
 */
export function createRuntime(velcro) {
  if (velcro.runtime) return velcro.runtime;

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
      this.root = new Module(this, 'velcro:/root', {});
      this.require = this.createRequire(this.root);
      /** @type {Record<string, Module[] | undefined>} */
      this.dependents = Object.create(null);
    }

    /**
     *
     * @param {Module} fromModule
     */
    createRequire(fromModule) {
      var runtime = this;

      /**
       *
       * @param {string} spec
       */
      function require(spec) {
        var id = runtime.resolveSpecAgainstImportMap(spec, fromModule);

        var module = runtime.modules[id];

        if (!module) {
          var moduleDefinition = runtime.defs[id];

          if (!moduleDefinition) {
            throw new Error(`Unable to locate module '${id}' from '${fromModule.id}`);
          }

          var [factory, importMap] = moduleDefinition;

          module = new Module(runtime, id, importMap);
          runtime.modules[id] = module;

          var specParts = id.split('/');
          var __filename = specParts.pop() || spec;
          var __dirname = specParts.join('/');

          factory.call(
            module.module.exports,
            module.module,
            module.module.exports,
            module.require.bind(module),
            __dirname,
            __filename
          );
        }

        (runtime.dependents[id] = runtime.dependents[id] || []).push(fromModule);

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
      var module = new Module(this, id, Object.create(null));

      module.module.exports = exports;

      this.modules[id] = module;

      return module;
    }

    /**
     *
     * @param {string[]} invalidations
     */
    invalidate(invalidations) {
      var queue = invalidations.slice();

      while (queue.length) {
        var id = queue.shift();

        //@ts-expect-error
        var deleted = delete this.modules[id];

        /** @type {Module[] | undefined} */
        //@ts-expect-error
        var dependents = this.dependents[id];

        if (!Array.isArray(dependents)) continue;

        dependents.forEach((dependent) => {
          queue.push(dependent.id);
        });
      }
    }

    /**
     *
     * @param {string} spec
     * @param {Module} module
     * @private
     */
    resolveSpecAgainstImportMap(spec, module) {
      var importMap = module.importMap;

      if (!importMap.scopes) {
        return spec;
      }

      var scopesForId = importMap.scopes[module.id];

      if (!scopesForId) {
        return spec;
      }

      var mappedId = scopesForId[spec];

      if (mappedId) {
        return mappedId;
      }

      return spec;
    }
  }

  var runtime = new Runtime(velcro);

  velcro.runtime = runtime;

  return runtime;
}
