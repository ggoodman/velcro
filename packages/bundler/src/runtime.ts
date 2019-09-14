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

      const ResolverHostUnpkg = Velcro.ResolverHostUnpkg;

      if (!ResolverHostUnpkg) {
        throw new Error('Velcro.ResolverHostUnpkg must be loaded for dynamic import');
      }

      const Resolver = Velcro.Resolver;

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

    require(id: string) {
      return this.root.require(id);
    }
  }

  class Module {
    public readonly exports = {};
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

        if (Velcro.util.dirname) {
          dirname = Velcro.util.dirname(id);
        }
        if (Velcro.util.basename) {
          filename = Velcro.util.basename(id);
        }

        if (Velcro.util)
          factory.call(module.exports, module, module.exports, module.require.bind(module), dirname, filename);
      }

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
