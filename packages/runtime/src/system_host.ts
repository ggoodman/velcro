import { Resolver } from '@velcro/resolver';
import MagicString from 'magic-string';

import { parse } from './ast';
import { isBareModuleSpecifier } from './bare_modules';
import { SystemHost, System, Registration } from './system';
import { traverse } from './traverse';
import { ICache, BareModuleResolver, GlobalInjector, CacheSegment } from './types';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from './visitors';
import { runLoaders } from './webpack_loader_runner';
import { injectUnresolvedFallback } from './util';

export interface SystemHostUnpkgOptions {
  cache?: ICache;
  enableSourceMaps?: boolean;
  injectGlobal?: GlobalInjector;
  resolveBareModule: BareModuleResolver;
}

export class SystemHostUnpkg implements SystemHost {
  private readonly enableSourceMaps: boolean;
  private readonly resolveBareModule: BareModuleResolver;
  private readonly injectGlobal: GlobalInjector | undefined;
  private readonly cache: ICache | undefined;

  private readonly inflightInstantiations = new Map<string, Promise<Registration>>();
  private readonly inflightResolutions = new Map<string, Promise<string>>();
  // private readonly dependencies = new Map<string, string>();

  // private readonly loaderCache = new Map<string, string>();

  constructor(public readonly resolver: Resolver, options: SystemHostUnpkgOptions) {
    this.cache = options.cache;
    this.resolveBareModule = options.resolveBareModule;
    this.injectGlobal = options.injectGlobal;
    this.enableSourceMaps = options.enableSourceMaps === true;
  }

  private async instantiateWithoutCache(loader: System, href: string, _parentHref?: string) {
    let code: string | undefined = undefined;

    const loaderSpec = parseLoaderSpec(href);

    if (loaderSpec.prefix || loaderSpec.loaders.length) {
      const result = await runLoaders({
        loaders: loaderSpec.loaders,
        resolver: this.resolver,
        resource: loaderSpec.resource,
        systemLoader: loader,
      });

      if (result.result) {
        const [codeVal] = result.result;
        code = typeof codeVal === 'string' ? codeVal : this.resolver.decoder.decode(codeVal);
      }
    }

    if (!code) {
      let url: URL;

      try {
        url = new URL(href);
      } catch (err) {
        // console.warn(originalHref, href, parentHref);
        throw new Error(`Error instantiating ${href} because it could not be resolved as a URL: ${err.message}`);
      }

      const codeBuf = await this.resolver.host.readFileContent(this.resolver, url);
      code = this.resolver.decoder.decode(codeBuf);
    }

    if (href.endsWith('.json')) {
      code = `"use strict";\nmodule.exports = ${code};`;
    }

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

    const codeWithSourceMap = this.enableSourceMaps
      ? `${magicString.toString()}\n//# sourceMappingURL=${magicString
          .generateMap({
            includeContent: false,
            source: href,
          })
          .toUrl()}`
      : magicString.toString();

    return {
      cacheable: true,
      registration: { href, code: codeWithSourceMap, requires },
    };
  }

  private async resolveWithoutCache(
    loader: System,
    href: string,
    parentHref?: string
  ): Promise<{ cacheable: boolean; id: string }> {
    if (href.startsWith('!') || (parentHref && parentHref.startsWith('!'))) {
      // We're resolving something related to webpack loaders
      const loaderSpec = parseLoaderSpec(href);
      const parentLoaderSpec = parentHref ? parseLoaderSpec(parentHref) : undefined;

      // 1. The main 'resource' is relative
      if (loaderSpec.resource.startsWith('.')) {
        if (parentLoaderSpec) {
          loaderSpec.resource = new URL(
            loaderSpec.resource,
            parentLoaderSpec.loaders[0] || parentLoaderSpec.resource
          ).href;
        }
      }

      if (loaderSpec.loaders.length) {
        loaderSpec.loaders = await Promise.all(loaderSpec.loaders.map(spec => loader.resolve(spec, parentHref)));
      }

      const id = `${loaderSpec.prefix}${loaderSpec.loaders.concat(loaderSpec.resource).join('!')}${loaderSpec.query}`;

      return {
        cacheable: true,
        id,
      };
    }

    let id = isBareModuleSpecifier(href)
      ? await this.resolveBareModule(loader, this.resolver, href, parentHref)
      : undefined;

    if (!id) {
      const url = new URL(href, parentHref);
      const resolved = await this.resolver.resolve(url);

      if (resolved) {
        id = resolved.href;
      }
    }

    if (!id) {
      return {
        cacheable: false,
        id: injectUnresolvedFallback(loader, href, parentHref),
      };
    }

    if (id.match(/\.css$/)) {
      return this.resolveWithoutCache(loader, `!!style-loader!css-loader!${id}`);
    }

    return {
      cacheable: true,
      id,
    };
  }

  async instantiate(loader: System, href: string, parentHref?: string) {
    const cacheKey = href;
    let inflightInstantiation = this.inflightInstantiations.get(cacheKey);

    if (!inflightInstantiation) {
      inflightInstantiation = (async () => {
        let registration: Registration | undefined = undefined;

        if (this.cache) {
          const cached = (await this.cache.get(CacheSegment.Instantiate, cacheKey)) as {
            code: string;
            href: string;
            requires: string[];
          };

          if (cached) {
            registration = createRegistration(cached.href, cached.code, cached.requires);
          }
        }

        if (!registration) {
          const result = await this.instantiateWithoutCache(loader, href, parentHref);

          if (result.cacheable && this.cache) {
            await this.cache.set(CacheSegment.Instantiate, cacheKey, result.registration);
          }

          registration = createRegistration(
            result.registration.href,
            result.registration.code,
            result.registration.requires
          );
        }

        return registration;
      })();

      this.inflightInstantiations.set(cacheKey, inflightInstantiation);
    }

    return inflightInstantiation;
  }

  async resolve(loader: System, href: string, parentHref?: string) {
    const cacheKey = `${href}|${parentHref}`;
    let inflightResolution = this.inflightResolutions.get(cacheKey);

    if (!inflightResolution) {
      inflightResolution = (async () => {
        if (this.cache) {
          const cached = await this.cache.get(CacheSegment.Resolve, cacheKey);

          if (cached) {
            return cached as string;
          }
        }

        const result = await this.resolveWithoutCache(loader, href, parentHref);

        if (result && result.cacheable && this.cache) {
          await this.cache.set(CacheSegment.Resolve, cacheKey, result.id);
        }

        return result.id;
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
      const __dirname = Resolver.path.dirname(href);
      const __filename = Resolver.path.basename(href);

      __meta.cjsExport(module);

      return {
        setters: requires.map(_dep => (_m: any) => {
          // console.log('setter', dep, m);
        }),
        execute() {
          // console.log('execute', href);
          try {
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

function parseLoaderSpec(spec: string) {
  const matches = spec.match(/^(!!?)?(.*?)(\?.*)?$/);

  if (!matches) {
    throw new Error(`Failed to parse the spec ${spec} as a webpack loader url`);
  }

  const [, prefix = '', body = '', query = ''] = matches;
  const loaders = body.split('!');
  const resource = loaders.pop() || '';

  return {
    loaders,
    prefix,
    query,
    resource,
  };
}
