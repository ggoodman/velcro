import { Resolver } from '@velcro/resolver';
import MagicString from 'magic-string';

import { parse } from './ast';
import { isBareModuleSpecifier } from './bare_modules';
import { SystemHost, System, Registration } from './system';
import { traverse } from './traverse';
import { ICache, BareModuleResolver, GlobalInjector } from './types';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from './visitors';

export interface SystemHostUnpkgOptions {
  cache?: ICache;
  injectGlobal?: GlobalInjector;
  resolveBareModule: BareModuleResolver;
}

export class SystemHostUnpkg implements SystemHost {
  private readonly resolveBareModule: BareModuleResolver;
  private readonly injectGlobal: GlobalInjector | undefined;
  private readonly cache: ICache | undefined;

  private readonly inflightInstantiations = new Map<string, Promise<Registration>>();
  private readonly inflightResolutions = new Map<string, Promise<string>>();
  // private readonly dependencies = new Map<string, string>();
  constructor(public readonly resolver: Resolver, options: SystemHostUnpkgOptions) {
    this.cache = options.cache;
    this.resolveBareModule = options.resolveBareModule;
    this.injectGlobal = options.injectGlobal;
  }

  private async instantiateWithoutCache(loader: System, href: string, _parentHref?: string) {
    let code: string;
    let url: URL;

    try {
      url = new URL(href);
    } catch (err) {
      // console.warn(originalHref, href, parentHref);
      throw new Error(`Error instantiating ${href} because it could not be resolved as a URL: ${err.message}`);
    }

    const codeBuf = await this.resolver.host.readFileContent(this.resolver, url);
    code = this.resolver.decoder.decode(codeBuf);

    const magicString = new MagicString(code, {
      filename: href,
      indentExclusionRanges: [],
    });
    const ctx: DependencyVisitorContext = {
      injectGlobals: new Set(),
      locals: new Map(),
      nodeEnv: 'development',
      replacements: [],
      requires: [],
      resolves: [],
      skip: new Set(),
    };

    try {
      const ast = parse(code);

      traverse(ast, ctx, scopingAndRequiresVisitor);

      if (this.injectGlobal) {
        traverse(ast, ctx, collectGlobalsVisitor);
      }
    } catch (err) {
      throw new Error(`Error parsing ${href}: ${err.message}`);
    }

    const resolvedInjectPromises = [] as Promise<void>[];
    const resolvedRequirePromises = [] as Promise<void>[];
    const resolvedResolvePromises = [] as Promise<void>[];
    const requires = [] as string[];
    // const requireMappings = {} as { [key: string]: string };
    // const resolveMappings = {} as { [key: string]: string };

    if (this.injectGlobal) {
      for (const globalName of ctx.injectGlobals) {
        const injectGlobal = this.injectGlobal(globalName);
        // const injectGlobal = DEFAULT_SHIM_GLOBALS[globalName];

        // console.warn('global(%s): %s', href, globalName, injectGlobal);

        if (injectGlobal) {
          resolvedInjectPromises.push(
            Promise.resolve(loader.resolve(injectGlobal.spec, href)).then(resolvedHref => {
              const injected = `var ${globalName} = require(${JSON.stringify(resolvedHref)});\n`;
              magicString.prepend(injected);

              requires.push(resolvedHref);

              // console.warn('injected(%s)', href, injected);
            })
          );
        }
      }
    }

    for (const dep of ctx.requires) {
      resolvedRequirePromises.push(
        Promise.resolve(loader.resolve(dep.value, href)).then(resolvedHref => {
          magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
          requires.push(resolvedHref);
          // requireMappings[dep.value] = resolvedHref;
        })
      );
    }

    for (const dep of ctx.resolves) {
      resolvedResolvePromises.push(
        Promise.resolve(loader.resolve(dep.value, href)).then(resolvedHref => {
          magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
          // resolveMappings[dep.value] = resolvedHref;
        })
      );
    }

    const promises = [...resolvedInjectPromises, ...resolvedRequirePromises, ...resolvedResolvePromises];

    if (promises.length) {
      await Promise.all(promises);
    }

    for (const replacement of ctx.replacements) {
      magicString.overwrite(replacement.start, replacement.end, replacement.replacement);
    }

    return { href, code: magicString.toString(), requires };
  }

  private async resolveWithoutCache(loader: System, href: string, parentHref?: string) {
    if (isBareModuleSpecifier(href)) {
      return this.resolveBareModule(loader, this.resolver, href, parentHref);
    }

    const url = new URL(href, parentHref);
    const resolved = await this.resolver.resolve(url);

    if (!resolved) {
      throw new Error(`Unable to resolve ${href}${parentHref ? `from ${parentHref}` : ''}`);
    }

    return resolved.href;
  }

  async instantiate(loader: System, href: string, parentHref?: string) {
    const cacheKey = `instantiate:${href}:${parentHref}`;
    let inflightInstantiation = this.inflightInstantiations.get(cacheKey);

    if (!inflightInstantiation) {
      inflightInstantiation = (async () => {
        let registration: Registration | undefined = undefined;

        if (this.cache) {
          const cached = (await this.cache.get(cacheKey)) as { code: string; href: string; requires: string[] };

          if (cached) {
            registration = createRegistration(cached.href, cached.code, cached.requires);
          }
        }

        if (!registration) {
          const result = await this.instantiateWithoutCache(loader, href, parentHref);

          if (this.cache) {
            await this.cache.set(cacheKey, result);
          }

          registration = createRegistration(result.href, result.code, result.requires);
        }

        return registration;
      })();

      this.inflightInstantiations.set(cacheKey, inflightInstantiation);
    }

    return inflightInstantiation;
  }

  async resolve(loader: System, href: string, parentHref?: string) {
    const cacheKey = `resolve:${href}:${parentHref}`;
    let inflightResolution = this.inflightResolutions.get(cacheKey);

    if (!inflightResolution) {
      inflightResolution = (async () => {
        if (this.cache) {
          const cached = await this.cache.get(cacheKey);

          if (cached) {
            return cached as string;
          }
        }

        const result = await this.resolveWithoutCache(loader, href, parentHref);

        if (result && this.cache) {
          await this.cache.set(cacheKey, result);
        }

        return result;
      })();

      this.inflightResolutions.set(cacheKey, inflightResolution);
    }

    return inflightResolution;
  }
}

function createRegistration(href: string, code: string, requires: string[]): Registration {
  const registration: Registration = [
    requires,
    function(__export, __meta) {
      // console.log('register', href);

      const require = Object.assign(
        function require(id: string) {
          // console.warn('require(%s): %s', id, href);
          return __meta.cjsRequire(id);
        },
        {
          resolve(id: string) {
            return id;
          },
        }
      );
      const exports = {};
      const module = { exports };
      // const map = magicString.generateMap({});
      const execute = new Function(
        'exports',
        'require',
        'module',
        '__filename',
        '__dirname',
        `${code}\n//# sourceURL=${href}`
      );
      const pathname = new URL(href).pathname;

      __meta.cjsExport(module);

      return {
        setters: requires.map(_dep => (_m: any) => {
          // console.log('setter', dep, m);
        }),
        execute() {
          // console.log('execute', href);

          try {
            const __dirname = Resolver.path.dirname(pathname);
            const __filename = Resolver.path.basename(pathname);

            execute.call(module, module.exports, require, module, __filename, __dirname);
          } catch (err) {
            const wrappedErr = new Error(`Error while executing ${href}: ${err.message}`);
            Object.defineProperty(wrappedErr, 'stack', {
              get() {
                return err.stack;
              },
            });

            throw wrappedErr;
          }
        },
      };
    },
  ];

  return registration;
}
