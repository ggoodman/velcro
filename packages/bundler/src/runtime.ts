type ModuleFactory = (
  this: any,
  module: { exports: any },
  exports: any,
  require: RequireFunction,
  __dirname: string,
  __pathname: string
) => void;

type RequireFunction = (spec: string) => any;

export interface IRuntime {
  alias(spec: string, href: string): void;
  import(sect: string): Promise<any>;
  register(spec: string, factory: ModuleFactory): any;
  remove(spec: string): boolean;
  require(spec: string): any;
}

export function createRuntime(Velcro: typeof import('./')): { new (): IRuntime } {
  const aliasesSymbol = Symbol.for('velcro.aliases');
  const modulesSymbol = Symbol.for('velcro.modules');
  const registrySymbol = Symbol.for('velcro.registry');
  const rootSymbol = Symbol.for('velcro.root');

  class Runtime implements IRuntime {
    readonly [aliasesSymbol] = Object.create(null) as Record<string, string | undefined>;
    readonly [modulesSymbol] = Object.create(null) as Record<string, Module | undefined>;
    readonly [registrySymbol] = Object.create(null) as Record<string, ModuleFactory | undefined>;

    private [rootSymbol]: Module;

    get root() {
      let root = this[rootSymbol];

      if (!root) {
        root = new Module('velcro://root', this);
        this[rootSymbol] = root;
      }

      return root;
    }

    alias(name: string, id: string) {
      this[aliasesSymbol][name] = id;
    }

    import(
      name: string,
      options: { packageMain?: Array<'main' | 'browser'>; extensions?: string[]; sourceMap?: boolean } = {}
    ) {
      const Bundler = Velcro.Bundler;

      if (!Bundler) {
        throw new Error('Velcro.Bundler must be loaded for dynamic import');
      }

      const ResolverHostUnpkg = ((Velcro as unknown) as typeof import('@velcro/resolver-host-unpkg')).ResolverHostUnpkg;

      if (!ResolverHostUnpkg) {
        throw new Error('Velcro.ResolverHostUnpkg must be loaded for dynamic import');
      }

      const Resolver = ((Velcro as unknown) as typeof import('@velcro/resolver')).Resolver;

      if (!Resolver) {
        throw new Error('Velcro.Resolver must be loaded for dynamic import');
      }

      const resolverHost = new ResolverHostUnpkg();
      const resolver = new Resolver(resolverHost, options);
      const bundler = new Bundler({ resolver });

      return bundler.add(name).then(() => {
        const code = bundler.generateBundleCode({ sourceMap: options.sourceMap });
        new Function(code)();

        return this.require(name);
      });
    }

    register(id: string, factory: ModuleFactory) {
      if (this[registrySymbol][id]) {
        throw new Error(`A module factory is already registered for ${id}`);
      }

      this[registrySymbol][id] = factory;
    }

    remove(id: string): boolean {
      id = this[aliasesSymbol][id] || id;
      const module = this[modulesSymbol][id];

      if (!module) {
        return false;
      }

      const seen = new Set<Module>();
      const removalQueue = [module];

      while (removalQueue.length) {
        const moduleToRemove = removalQueue.shift()!;

        if (seen.has(moduleToRemove)) {
          continue;
        }
        seen.add(moduleToRemove);

        removalQueue.push(...moduleToRemove.dependents);

        delete this[modulesSymbol][moduleToRemove.id];
      }

      return true;
    }

    require(id: string) {
      return this.root.require(id);
    }
  }

  class Module {
    public readonly exports = {};
    public readonly dependents = new Set<Module>();

    constructor(public readonly id: string, private readonly runtime: Runtime) {}
    require(id: string) {
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

        const util = ((Velcro as unknown) as typeof import('@velcro/resolver')).util;

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
    }
  }

  let runtime = Velcro.runtime as Runtime;

  if (!runtime) {
    runtime = new Runtime();
    (Velcro as any).runtime = runtime;
  }

  return Runtime;
}
