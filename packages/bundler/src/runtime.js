//@ts-check

/**
 *
 * @param {import('./types').ImmediateExecutionManifest} manifest
 * @param {import('./types').RuntimeOptions} [options]
 * @returns {import('./types').IRuntime}
 */
export function createRuntime(manifest, options) {
  /** @type {Record<string, string | undefined>} */
  var aliases = Object.create(null);
  /** @type {Record<string, Record<string, string | undefined> | undefined> } */
  var mappings = Object.create(null);
  /** @type {Record<string, Module | undefined>} */
  var modules = Object.create(null);
  /** @type {Record<string, import('./types').ModuleFactory | undefined>} */
  var registry = Object.create(null);

  /**
   * @template T
   * @param {T[]} set
   * @param {T} value
   * @returns {T[]}
   */
  function addToSet(set, value) {
    var idx = set.indexOf(value);

    if (idx === -1) set.push(value);

    return set;
  }

  /**
   * @class
   * @implements {import('./types').IRuntime}
   * @property {Module} root
   */
  function Runtime() {
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

    var self = this;

    this.register('@@runtime', function(module) {
      module.exports = self;
    });
  }

  /**
   * @param {string} name
   * @param {string} id
   */
  Runtime.prototype.alias = function(name, id) {
    aliases[name] = id;
  };

  /**
   * @param {string} fromId
   * @param {string} spec
   * @param {string} toId
   */
  Runtime.prototype.dependency = function(fromId, spec, toId) {
    var mappingsForId = mappings[fromId];

    if (!mappingsForId) {
      mappingsForId = {};
      mappings[fromId] = mappingsForId;
    }

    mappingsForId[spec] = toId;
  };

  /**
   * @param {string} id
   */
  Runtime.prototype.get = function(id) {
    id = aliases[id] || id;

    return modules[id];
  };

  /**
   * @param {string} fromId
   * @param {string} spec
   * @returns {string}
   */
  Runtime.prototype.getId = function(fromId, spec) {
    var alias = aliases[spec];

    if (alias) {
      return alias;
    }

    var mappingsForId = mappings[fromId];

    return (mappingsForId && mappingsForId[spec]) || spec;
  };

  /**
   * @param {import('./types').ImmediateExecutionManifest} manifest
   * @param {boolean} [executeEntrypoints]
   */
  Runtime.prototype.init = function(manifest, executeEntrypoints) {
    for (const href in manifest.modules) {
      var module = manifest.modules[href];

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

      if (executeEntrypoints) {
        this.require(entrypoint);
      }
    }
  };

  /**
   * @param {string} id
   * @param {import('./types').ModuleFactory} factory
   */
  Runtime.prototype.register = function(id, factory) {
    if (!registry[id]) {
      registry[id] = factory;
    }
  };

  /**
   * @param {string} id
   * @returns {Module | undefined}
   */
  Runtime.prototype.remove = function(id) {
    var module = this.get(id);

    if (!module) {
      return;
    }

    delete modules[module.id];
    delete mappings[module.id];
    delete registry[module.id];

    return module;
  };

  /**
   * @param {string} id
   */
  Runtime.prototype.require = function(id) {
    return this.root.require(aliases[id] || id);
  };

  /**
   * @class
   * @param {Module} module
   */
  function HotModule(module) {
    /** @private */
    this.module = module;
  }

  /**
   * @param {() => void} cb
   */
  HotModule.prototype.accept = function(cb) {
    this.module.acceptCallbacks.push({ cb: cb });
  };

  /**
   * @param {() => void} cb
   */
  HotModule.prototype.dispose = function(cb) {
    this.module.disposeCallbacks.push({ cb: cb });
  };

  /**
   * @class
   * @param {string} id
   * @param {Runtime} runtime
   */
  function Module(id, runtime) {
    /** @type {Module[]} */
    this.dependencies = [];
    /** @type {Module[]} */
    this.dependents = [];
    this.id = id;
    /** @type {import('./types').AcceptCallback[]} */
    this.acceptCallbacks = [];
    /** @type {import('./types').DisposeCallback[]} */
    this.disposeCallbacks = [];

    /** @readonly */
    this.module = Object.seal({
      exports: {},
      hot: new HotModule(this),
    });

    /** @readonly */
    this.runtime = runtime;
  }

  /**
   * @param {string} id
   */
  Module.prototype.require = function(id) {
    id = this.runtime.getId(this.id, id);

    /** @type {Module | undefined} */
    var module = modules[id];

    if (!module) {
      const factory = registry[id];

      if (!factory) {
        console.error();
        throw new Error(`Factory missing for ${id}`);
      }

      module = new Module(id, this.runtime);

      modules[id] = module;

      // Free up the registry entry and release any refs for GC
      delete registry[id];

      var dirname = id;
      var filename = id;

      factory.call(
        module.module.exports,
        module.module,
        module.module.exports,
        module.require.bind(module),
        dirname,
        filename
      );
    }

    addToSet(module.dependents, module);
    addToSet(this.dependencies, module);

    return module.module.exports;
  };

  //@ts-ignore
  const runtime = (options && options.runtime && window[options.runtime]) || new Runtime();

  runtime.init(manifest, options && options.executeEntrypoints);

  return runtime;
}
