const REGISTRY = Symbol('registry');

export interface Context {
  url: string;
  [key: string]: any;
}

type Dependencies = string[];
interface SystemJSDeclaration {
  execute?: () => Promise<unknown> | unknown;
  setters?: Setter[];
}
export interface DeclareFunction {
  (exportFn: SystemJSExportFunction, importObject: SystemJSContext): SystemJSDeclaration;
}

interface SystemJSExportFunction {
  (name: string | { [key: string]: any }, value?: any): any;
}

interface SystemJSContext {
  import(id: string): Promise<any>;
  meta?: Context;
  cjsExport: SystemJSExportFunction;
  cjsRequire: SystemJSRequireFunction;
}

interface SystemJSRequireFunction {
  (id: string): any;
}

interface SystemJSExportFunction {
  (id: any): void;
}

export interface SystemHost {
  createContext?(loader: System, url: string): Context;
  instantiate(loader: System, url: string, firstParentUrl?: string): Registration | PromiseLike<Registration>;
  onload?(loader: System, id: string, err?: Error): void;
  resolve(loader: System, id: string, parentId?: string): string | PromiseLike<string>;
}

type SystemJSImporterNamespace = any;

interface Setter {
  (ns: SystemJSImporterNamespace): void;
}

interface SystemJSLoad {
  /**
   * Module id
   */
  id: string;

  /**
   * Array of import setters
   *
   * We retain this to add more later
   */
  i: Setter[];

  /**
   * Instantiation promise
   */
  I: Promise<unknown> | undefined;

  /**
   * Link promise
   */
  L: Promise<unknown> | undefined;

  /**
   * Whether there are hoisted exports
   */
  h: boolean;

  /**
   * Dependency load records
   *
   * Will be populated upon completion of instantiation
   */
  d: SystemJSLoad[] | undefined;

  /**
   * Execution function
   *
   * Will be set to null immediately after execution (or failure) to indicate
   * execution has happened. In such a case, C should be used, and L and I will be emptied
   */
  e: (() => unknown) | null | undefined;

  /**
   * Instantiation error
   */
  er?: Error;

  /**
   * Top level execution promise when there is a top-level await
   */
  E: Promise<void> | null | undefined;

  /**
   * Promise for top-level completion
   */
  C: Promise<SystemJSImporterNamespace> | SystemJSImporterNamespace | undefined;

  /**
   * Module namespace object
   */
  n: SystemJSImporterNamespace | undefined;
}

export type Instantiation = [Dependencies, Setter[]];
export type Registration = [Dependencies, DeclareFunction];

// function isInstantiatedModule(m: unknown): m is InstantiatedModule {
//   return m && typeof m === 'object' && (m as any)[toStringTag] === 'Module';
// }

export class System {
  private _host: SystemHost;
  // private _lastError: Error | undefined;
  private _lastRegister: Registration | undefined;

  private _registeredModules = new Set<any>();

  // the closest we can get to call(undefined)
  private static _nullContext = Object.freeze(Object.create(null));

  private [REGISTRY] = Object.create(null) as {
    [id: string]: SystemJSLoad;
  };

  constructor(host: SystemHost) {
    this._host = host;
  }

  delete(id: string): boolean {
    const load = this[REGISTRY][id];
    if (load === undefined) return false;
    // remove from importerSetters
    // (release for gc)
    // if (load && load.d)
    //   load.d.forEach(function(depLoad) {
    //     // TODO(@ggoodman): I do not understand why this check is happening
    //     const importerIndex = depLoad.i.indexOf(load.e);
    //     if (importerIndex !== -1) depLoad.i.splice(importerIndex, 1);
    //   });

    delete this[REGISTRY][id];

    return this._registeredModules.delete(load.n);
  }

  get(id: string) {
    const load = this[REGISTRY][id];

    if (load && load.e === null && !load.E) {
      if (!load.er) {
        return load.n && load.n.__cjsModule ? load.n.module.exports : load.n;
      }
    }
  }

  has(id: string) {
    const load = this[REGISTRY][id];
    return load && load.e === null && !load.E;
  }

  set(id: string, ns: SystemJSImporterNamespace) {
    const done = Promise.resolve(ns);
    this.delete(id);
    this[REGISTRY][id] = {
      id: id,
      i: [],
      n: ns,
      I: done,
      L: done,
      h: false,
      d: [],
      e: null,
      er: undefined,
      E: undefined,
      C: done,
    };
    this._registeredModules.add(ns);
    return ns;
  }

  /**
   * Hookable createContext function -> allowing eg custom import meta
   *
   * @param parentId
   */
  protected createContext(parentId: string): Context {
    if (this._host.createContext) {
      return this._host.createContext(this, parentId);
    }

    return {
      url: parentId,
    };
  }

  getRegister(): Registration | undefined {
    const lastRegister = this._lastRegister;
    this._lastRegister = undefined;
    return lastRegister;
  }

  async import(id: string, parentUrl?: string) {
    const resolvedId = await this.resolve(id, parentUrl);
    const load = await System.getOrCreateLoad(this, resolvedId);

    return (load.C || System.topLevelLoad(this, load)).then(() => this.get(resolvedId));
  }

  protected instantiate(url: string, firstParentUrl?: string): Registration | PromiseLike<Registration> {
    return this._host.instantiate(this, url, firstParentUrl);
  }

  async preLoad(id: string, parentUrl?: string): Promise<void> {
    const resolvedId = await this.resolve(id, parentUrl);
    const load = await System.getOrCreateLoad(this, resolvedId);
    await System.instantiateAll(this, load, {});
  }

  protected onload(id: string, err?: Error) {
    if (this._host.onload) {
      this._host.onload(this, id, err);
    }
  }

  register(deps: Dependencies, declare: DeclareFunction): void {
    this._lastRegister = [deps, declare];
  }

  resolve(id: string, parentUrl?: string): string | PromiseLike<string> {
    return this._host.resolve(this, id, parentUrl);
  }

  protected static getOrCreateLoad(loader: System, id: string, firstParentUrl?: string): SystemJSLoad {
    let load = loader[REGISTRY][id];
    if (load) return load;

    const importerSetters: Setter[] = [];

    let ns = Object.create(null, {
      [Symbol.toStringTag]: {
        value: 'Module',
      },
    });

    let instantiatePromise: Promise<Instantiation> = Promise.resolve()
      .then(function() {
        return loader.instantiate(id, firstParentUrl);
      })
      .then(function(registration) {
        if (!registration) throw new Error('Module ' + id + ' did not instantiate');
        if (!Array.isArray(registration)) throw new Error(`Module ${id} produced an unexpected instantiation result`);

        const __export = function _export(name: string | { [key: string]: any }, value?: any) {
          // note if we have hoisted exports (including reexports)
          load.h = true;
          let changed = false;

          if (typeof name !== 'object') {
            if (!(name in ns) || ns[name] !== value) {
              ns[name] = value;
              changed = true;
            }
          } else {
            for (let p in name) {
              let value = name[p];
              if (!(p in ns) || ns[p] !== value) {
                ns[p] = value;
                changed = true;
              }
            }
          }
          if (changed) for (let i = 0; i < importerSetters.length; i++) importerSetters[i](ns);
          return value;
        };
        const __context = {
          import: function(importId: string) {
            return loader.import(importId, id);
          },
          meta: loader.createContext(id),
          cjsExport(module: any) {
            Object.defineProperty(ns, '__cjsModule', {
              value: true,
            });

            // // Hack for legacy typescript
            // if (module.exports.__esModule === true) {
            //   console.log('esModule', id, module.exports);
            //   const props = Object.getOwnPropertyNames(module.exports);

            //   if (props.length === 1 && props[0] === 'default') {
            //     module.exports = Object.assign(module.exports.default, {
            //       default: module.exports.default,
            //     });
            //   }
            // }

            ns.module = module;

            for (let i = 0; i < importerSetters.length; i++) importerSetters[i](ns.module.exports);

            return exports;
          },
          cjsRequire: function(id: string) {
            const load = loader[REGISTRY][id];

            if (!load) {
              throw new Error(`Module not found ${id}`);
            }

            if (load.e === null) {
              return load.n && load.n.__cjsModule ? load.n.module.exports : load.n;
            }

            if (load.er) {
              throw load.er;
            }

            if (load.e) {
              System.doExec(loader, load);

              return load.n && load.n.__cjsModule ? load.n.module.exports : load.n;
            }

            throw new Error('WAT?');
          },
        };
        const declare = registration[1];
        const declared = declare(__export, __context);
        load.e = declared.execute || function() {};

        const instantiation: Instantiation = [registration[0], declared.setters || []];

        return instantiation;
      });

    instantiatePromise = instantiatePromise.catch(function(err) {
      loader.onload(load.id, err);
      return Promise.reject(err);
    });

    const linkPromise = instantiatePromise.then(function(instantiation) {
      return Promise.all(
        instantiation[0].map(function(dep, i) {
          const setter = instantiation[1][i];
          return Promise.resolve(loader.resolve(dep, id)).then(function(depId) {
            const depLoad = System.getOrCreateLoad(loader, depId, id);

            // depLoad.I may be undefined for already-evaluated
            return Promise.resolve(depLoad.I).then(function() {
              if (setter) {
                depLoad.i.push(setter);
                // only run early setters when there are hoisted exports of that module
                // the timing works here as pending hoisted export calls will trigger through importerSetters
                if (depLoad.h || !depLoad.I) setter(depLoad.n!);
              }
              return depLoad;
            });
          });
        })
      ).then(function(depLoads) {
        load.d = depLoads;
      });
    });

    // disable unhandled rejections
    linkPromise.catch(function(err) {
      load.e = null;
      load.er = err;
    });

    return (load = loader[REGISTRY][id] = {
      id,
      i: importerSetters,
      n: ns,
      I: instantiatePromise,
      L: linkPromise,
      h: false,
      d: undefined,
      e: undefined,
      er: undefined,
      E: undefined,
      C: undefined,
    });
  }

  protected static instantiateAll(
    loader: System,
    load: SystemJSLoad,
    loaded: { [key: string]: boolean }
  ): Promise<unknown> | undefined {
    if (!loaded[load.id]) {
      loaded[load.id] = true;
      // load.L may be undefined for already-instantiated
      return Promise.resolve(load.L).then(function() {
        if (!load.d) {
          throw new Error('Invariant error: load dependencies not populated');
        }

        return Promise.all(
          load.d.map(function(dep) {
            return System.instantiateAll(loader, dep, loaded);
          })
        );
      });
    }
  }

  protected static topLevelLoad(
    loader: System,
    load: SystemJSLoad
  ): Promise<SystemJSImporterNamespace> | SystemJSImporterNamespace {
    const instantiated = System.instantiateAll(loader, load, {});

    if (!instantiated) {
      throw new Error('Invariant error: top level loading failed to produce an instantiation');
    }

    load.C = instantiated.then(() => System.postOrderExec(loader, load, new Set())).then(() => load.n);

    return load.C;
  }

  // returns a promise if and only if a top-level await subgraph
  // throws on sync errors
  protected static postOrderExec(loader: System, load: SystemJSLoad, seen: Set<string>): Promise<any> | undefined {
    // console.log('postOrderExec(%s)', load.id);
    if (seen.has(load.id)) {
      return;
    }
    seen.add(load.id);

    if (!load.e) {
      if (load.er) throw load.er;
      if (load.E) return load.E;
      return;
    }

    if (!load.d) {
      throw new Error('Invariant error: load dependencies not populated');
    }

    if (load.n && load.n.__cjsModule) {
      // This is an eager evaluation, (CommonJS)
      return System.doExec(loader, load);
    }

    // deps execute first, unless circular
    const depLoadPromises: Promise<void>[] = [];
    load.d.forEach(function(depLoad) {
      let depLoadPromise: Promise<void> | undefined = undefined;
      try {
        depLoadPromise = System.postOrderExec(loader, depLoad, seen);
      } catch (err) {
        loader.onload(load.id, err);
        throw err;
      }

      if (depLoadPromise) {
        depLoadPromises.push(depLoadPromise);
      }
    });
    if (depLoadPromises.length) {
      return Promise.all(depLoadPromises)
        .then(function() {
          return System.doExec(loader, load);
        })
        .catch(function(err: Error) {
          loader.onload(load.id, err);
          return Promise.reject(err);
        });
    }

    return System.doExec(loader, load);
  }

  protected static doExec(loader: System, load: SystemJSLoad): Promise<void> | undefined {
    if (!load.e) {
      // throw new Error('Invariant violation: attempting to execute the body of an executed module');
      return;
    }

    const e = load.e;

    try {
      load.e = null;
      const execResult = e.call(System._nullContext);
      if (isExecPromise(execResult)) {
        const execPromise = execResult.then(
          function() {
            load.C = load.n;
            load.E = null; // indicates completion
            loader.onload(load.id);
          },
          function(err: Error) {
            loader.onload(load.id, err);
            throw err;
          }
        );
        execPromise.catch(function() {});
        return (load.E = load.E || execPromise);
      }
      // (should be a promise, but a minify optimization to leave out Promise.resolve)
      load.C = load.n;
      loader.onload(load.id);
    } catch (err) {
      loader.onload(load.id, err);
      load.er = err;
      throw err;
    } finally {
      load.L = load.I = undefined;
    }
  }
}

function isExecPromise(result: unknown): result is Promise<void> {
  return result && result instanceof Promise;
}
