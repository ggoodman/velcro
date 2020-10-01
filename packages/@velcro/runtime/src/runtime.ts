import { Module } from './module';
import type {
  ModuleDefinitions,
  VelcroEnvironment,
  VelcroImportMap,
  VelcroModuleFactory,
  VelcroModuleGeneration,
  VelcroRequire,
} from './types';

export class Runtime {
  readonly defs: ModuleDefinitions;
  readonly dependents: { [id: string]: Module[] | undefined } = {};
  readonly modules: { [id: string]: Module | undefined } = {};
  readonly root: Module;

  readonly require!: VelcroRequire;

  constructor(registry: {
    defs: {
      [key: string]: [VelcroModuleFactory, VelcroImportMap, VelcroModuleGeneration] | undefined;
    };
  }) {
    this.defs = registry.defs;
    this.root = new Module(this, 'velcro:/root', {});

    // We define require as a property because it is not enough for it to be a method.
    // Recall that require functions also have a `.resolve` method hanging off.
    Object.defineProperty(this, 'require', {
      enumerable: true,
      value: this.root.require.bind(this.root),
    });
  }

  createRequire(fromModule: Module): VelcroRequire {
    const runtime = this;

    function require(spec: string) {
      const id = resolve(spec);

      let module = runtime.modules[id];

      if (!module) {
        const moduleDefinition = runtime.defs[id];

        if (!moduleDefinition) {
          throw new Error(`Unable to locate module '${id}' from '${fromModule.id}`);
        }

        const factory = moduleDefinition[0];
        const importMap = moduleDefinition[1];

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

      (runtime.dependents[id] = runtime.dependents[id] || []).push(fromModule);

      return module.module.exports;
    }

    function resolve(spec: string) {
      return runtime.resolveSpecAgainstImportMap(spec, fromModule);
    }

    return Object.assign(require, { resolve });
  }

  inject<T = unknown>(id: string, exports: T) {
    const moduleInstance = new Module(this, id, Object.create(null));

    moduleInstance.module.exports = exports;

    this.modules[id] = moduleInstance;

    return moduleInstance;
  }

  invalidate(invalidations: string[]) {
    const queue = invalidations.slice();
    let invalidated = false;

    while (queue.length) {
      const id = queue.shift()!;
      invalidated = delete this.modules[id] || invalidated;
      const dependents = this.dependents[id];

      if (!Array.isArray(dependents)) continue;

      for (var i = 0; i < dependents.length; i++) {
        queue.push(dependents[i].id);
      }
    }

    return invalidated;
  }

  private resolveSpecAgainstImportMap(spec: string, module: Module) {
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

  static create(Velcro: VelcroEnvironment) {
    if (!Velcro.runtime) {
      Velcro.runtime = new Runtime(Velcro.registry);
    }

    Velcro.Module = Module;
    Velcro.Runtime = Runtime;

    return Velcro.runtime;
  }
}
