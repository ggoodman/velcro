//@ts-check
'use strict';

/**
 * @param {import('./types').VelcroStaticRuntime} velcro
 * @returns {import('./runtimeInterface').VelcroRuntime}
 */
export function createRuntime(velcro) {
  if (velcro.runtime) return velcro.runtime;

  /**
   * @constructor
   * @param {Runtime} runtime
   * @param {string} id
   * @param {import('./types').VelcroImportMap} importMap
   */
  function Module(runtime, id, importMap) {
    this.runtime = runtime;
    this.id = id;
    this.importMap = importMap;
    this.module = { exports: {} };
    this.require = runtime.createRequire(this);
  }

  /**
   * @constructor
   * @param {import('./types').VelcroStaticRuntime} velcro
   */
  function Runtime(velcro) {
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

  Runtime.prototype.createRequire = createRequire;
  Runtime.prototype.inject = inject;
  Runtime.prototype.invalidate = invalidate;
  Runtime.prototype.resolveSpecAgainstImportMap = resolveSpecAgainstImportMap;

  /**
   *
   * @this {Runtime}
   * @param {Module} fromModule
   */
  function createRequire(fromModule) {
    var runtime = this;

    /**
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

        var factory = moduleDefinition[0];
        var importMap = moduleDefinition[1];

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
   * @this {Runtime}
   * @param {string} id Identifier of module
   * @param {T} exports Value that represents the exported interface of the module
   */
  function inject(id, exports) {
    var module = new Module(this, id, Object.create(null));

    module.module.exports = exports;

    this.modules[id] = module;

    return module;
  }

  /**
   *
   * @this {Runtime}
   * @param {string[]} invalidations
   */
  function invalidate(invalidations) {
    var queue = invalidations.slice();

    while (queue.length) {
      var id = queue.shift();

      //@ts-expect-error
      var deleted = delete this.modules[id];

      /** @type {Module[] | undefined} */
      //@ts-expect-error
      var dependents = this.dependents[id];

      if (!Array.isArray(dependents)) continue;

      for (var i = 0; i < dependents.length; i++) {
        queue.push(dependents[i].id);
      }
    }
  }

  /**
   *
   * @this {Runtime}
   * @param {string} spec
   * @param {Module} module
   * @private
   */
  function resolveSpecAgainstImportMap(spec, module) {
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

  var runtime = new Runtime(velcro);

  velcro.runtime = runtime;

  return runtime;
}
