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
  private readonly defs: ModuleDefinitions;
  private readonly moduleDependents: { [id: string]: Module[] | undefined } = {};
  private readonly moduleInstances: { [id: string]: Module | undefined } = {};
  private readonly root: Module;

  readonly require!: VelcroRequire;

  constructor(registry: {
    defs: {
      [key: string]: [VelcroModuleFactory, VelcroImportMap, VelcroModuleGeneration] | undefined;
    };
  }) {
    this.defs = registry.defs;
    this.root = new Module(this, 'velcro:/root', {});

    Object.defineProperty(this, 'require', {
      enumerable: true,
      value: this.root.require.bind(this.root),
    });
  }

  createRequire(fromModule: Module): VelcroRequire {
    const runtime = this;

    function require(spec: string) {
      const id = resolve(spec);

      let module = runtime.moduleInstances[id];

      if (!module) {
        const moduleDefinition = runtime.defs[id];

        if (!moduleDefinition) {
          throw new Error(`Unable to locate module '${id}' from '${fromModule.id}`);
        }

        const factory = moduleDefinition[0];
        const importMap = moduleDefinition[1];

        module = new Module(runtime, id, importMap);
        runtime.moduleInstances[id] = module;

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

      (runtime.moduleDependents[id] = runtime.moduleDependents[id] || []).push(fromModule);

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

    this.moduleInstances[id] = moduleInstance;

    return moduleInstance;
  }

  invalidate(invalidations: string[]) {
    const queue = invalidations.slice();
    let invalidated = false;

    while (queue.length) {
      const id = queue.shift()!;
      invalidated = delete this.moduleInstances[id] || invalidated;
      const dependents = this.moduleDependents[id];

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
