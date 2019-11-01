//@ts-check

/**
 *
 * @param {import('./runtime').RuntimeManifest} manifest
 * @returns {import('./runtime').IRuntime}
 */
export function createRuntime(manifest) {
  const aliasesSymbol = Symbol.for('velcro.aliases');
  const mappingsSymbol = Symbol.for('velcro.mappings');
  const modulesSymbol = Symbol.for('velcro.modules');
  const registrySymbol = Symbol.for('velcro.registry');

  /**
   * @class
   * @property {Module} root
   */
  function Runtime() {
    this[aliasesSymbol] = Object.create(null);
    this[mappingsSymbol] = Object.create(null);
    this[modulesSymbol] = Object.create(null);
    this[registrySymbol] = Object.create(null);

    /**
     * @readonly
     */
    this.root = new Module('velcro://root', this);

    Object.defineProperty(this, Symbol.toStringTag, {
      configurable: false,
      enumerable: false,
      get() {
        return 'Module';
      },
    });
  }

  /**
   * @param {string} name
   * @param {string} id
   */
  Runtime.prototype.alias = function(name, id) {
    this[aliasesSymbol][name] = id;
  };

  /**
   * @param {string} fromId
   * @param {string} spec
   * @param {string} toId
   */
  Runtime.prototype.dependency = function(fromId, spec, toId) {
    if (!(fromId in this[mappingsSymbol])) {
      this[mappingsSymbol][fromId] = Object.create(null);
    }
    this[mappingsSymbol][fromId][spec] = toId;
  };

  /**
   * @param {string} fromId
   * @param {string} spec
   */
  Runtime.prototype.getId = function(fromId, spec) {
    if (spec in this[aliasesSymbol]) {
      return this[aliasesSymbol][spec];
    }

    var mappings = this[mappingsSymbol][fromId];

    if (mappings && spec in mappings) {
      return mappings[spec];
    }

    return spec;
  };

  /**
   * @param {string} name
   */
  Runtime.prototype.import = function(name) {
    return new Promise((resolve, reject) => {
      try {
        return resolve(this.require(name));
      } catch (err) {
        return reject(err);
      }
    });
  };

  /**
   * @param {import('./runtime').RuntimeManifest} manifest
   */
  Runtime.prototype.init = function(manifest) {
    for (const href in manifest.modules) {
      const module = manifest.modules[href];

      for (const alias in module.dependencies) {
        this.dependency(href, alias, module.dependencies[alias]);
      }
      this.register(href, module.factory);
    }

    for (const alias in manifest.aliases) {
      this.alias(alias, manifest.aliases[alias]);
    }

    for (const entrypoint in manifest.entrypoints) {
      this.alias(entrypoint, manifest.entrypoints[entrypoint]);
      this.require(entrypoint);
    }
  };

  /**
   * @param {string} id
   * @param {import('./runtime').ModuleFactory} factory
   */
  Runtime.prototype.register = function(id, factory) {
    if (!this[registrySymbol][id]) {
      this[registrySymbol][id] = factory;
    }
  };

  /**
   * @param {string} id
   */
  Runtime.prototype.remove = function(id) {
    id = this[aliasesSymbol][id] || id;
    const module = this[modulesSymbol][id];

    if (!module) {
      return false;
    }

    const seen = new Set();
    const removalQueue = [module];

    while (removalQueue.length) {
      const moduleToRemove = removalQueue.shift();

      if (seen.has(moduleToRemove)) {
        continue;
      }
      seen.add(moduleToRemove);

      removalQueue.push(...moduleToRemove.dependents);

      delete this[modulesSymbol][moduleToRemove.id];
      delete this[mappingsSymbol][moduleToRemove.id];
    }

    return true;
  };

  /**
   * @param {string} id
   */
  Runtime.prototype.require = function(id) {
    return this.root.require(this[aliasesSymbol][id] || id);
  };

  /**
   * @class
   * @param {string} id
   * @param {Runtime} runtime
   */
  function Module(id, runtime) {
    this.exports = {};
    this.dependents = new Set();
    this.id = id;
    this.runtime = runtime;
  }

  /**
   * @param {string} id
   */
  Module.prototype.require = function(id) {
    id = this.runtime.getId(this.id, id);

    let module = this.runtime[modulesSymbol][id];

    if (!module) {
      const factory = this.runtime[registrySymbol][id];

      if (!factory) {
        console.error();
        throw new Error(`Factory missing for ${id}`);
      }

      module = new Module(id, this.runtime);

      this.runtime[modulesSymbol][id] = module;

      let dirname = id;
      let filename = id;

      // const util = Velcro.util;

      // if (util && util.dirname) {
      //   dirname = util.dirname(id);
      // }
      // if (util && util.basename) {
      //   filename = util.basename(id);
      // }

      factory.call(module.exports, module, module.exports, module.require.bind(module), dirname, filename);
    }

    module.dependents.add(this);

    return module.exports;
  };

  const runtime = new Runtime();

  runtime.init(manifest);

  return runtime;
}
