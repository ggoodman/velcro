/**
 *
 * @param {typeof import('.')} Velcro
 * @returns {import('./runtime').IRuntime}
 */
export function createRuntime(Velcro) {
  const aliasesSymbol = Symbol.for('velcro.aliases');
  const modulesSymbol = Symbol.for('velcro.modules');
  const registrySymbol = Symbol.for('velcro.registry');
  const rootSymbol = Symbol.for('velcro.root');

  function Runtime() {
    this[aliasesSymbol] = Object.create(null);
    this[modulesSymbol] = Object.create(null);
    this[registrySymbol] = Object.create(null);
    this[Symbol.toStringTag] = 'Module';

    const self = this;

    Object.defineProperty(this, 'root', {
      configurable: false,
      enumerable: true,
      get() {
        let root = self[rootSymbol];

        if (!root) {
          root = new Module('velcro://root', self);
          self[rootSymbol] = root;
        }

        return root;
      },
    });
  }

  Runtime.prototype.alias = function(name, id) {
    this[aliasesSymbol][name] = id;
  };

  Runtime.prototype.import = function(name) {
    return new Promise((resolve, reject) => {
      try {
        return resolve(Velcro.runtime.require(name));
      } catch (err) {
        return reject(err);
      }
    });
  };

  /**
   * @param {string} id
   * @param {ModuleFactory} factory
   */
  Runtime.prototype.register = function(id, factory) {
    if (!this[registrySymbol][id]) {
      this[registrySymbol][id] = factory;
    }
  };

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
    }

    return true;
  };

  Runtime.prototype.require = function(id) {
    return this.root.require(this[aliasesSymbol][id] || id);
  };

  function Module(id, runtime) {
    this.exports = {};
    this.dependents = new Set();
    this.id = id;
    this.runtime = runtime;
  }

  Module.prototype.require = function(id) {
    id = this.runtime[aliasesSymbol][id] || id;

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

      const util = Velcro.util;

      if (util && util.dirname) {
        dirname = util.dirname(id);
      }
      if (util && util.basename) {
        filename = util.basename(id);
      }

      factory.call(module.exports, module, module.exports, module.require.bind(module), dirname, filename);
    }

    module.dependents.add(this);

    return module.exports;
  };

  var runtime = Velcro.runtime;

  if (!runtime) {
    runtime = new Runtime();
    Velcro.runtime = runtime;
  }

  return Runtime;
}
