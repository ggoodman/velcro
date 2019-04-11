import { Resolver } from '@velcro/resolver';
import MagicString from 'magic-string';

import { parse } from './ast';
import { isBareModuleSpecifier, parseBareModuleSpec } from './bare_modules';
import { SystemHost, System, Registration } from './system';
import { traverse } from './traverse';
import { ICache, BareModuleResolver } from './types';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from './visitors';

const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
  Buffer: {
    spec: 'buffer@5.2.1',
    export: 'Buffer',
  },
  global: {
    spec: 'global@4.3.2',
  },
  process: {
    spec: 'process@0.11.0',
    export: 'default',
  },
};

export interface SystemHostUnpkgOptions {
  cache?: ICache;
  resolveBareModule: BareModuleResolver;
  shouldInjectGlobals?: boolean;
}

export class SystemHostUnpkg implements SystemHost {
  private readonly resolveBareModule: BareModuleResolver;
  private readonly shouldInjectGlobals: boolean;
  // private readonly cache: ICache | undefined;
  // private readonly dependencies = new Map<string, string>();
  constructor(public readonly resolver: Resolver, options: SystemHostUnpkgOptions) {
    // this.cache = options.cache;
    this.resolveBareModule = options.resolveBareModule;
    this.shouldInjectGlobals = !!options.shouldInjectGlobals;
  }

  async instantiate(loader: System, href: string, _parentHref?: string) {
    const requestHref = href;
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

      if (this.shouldInjectGlobals) {
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

    if (this.shouldInjectGlobals) {
      for (const globalName of ctx.injectGlobals) {
        const injectGlobal = DEFAULT_SHIM_GLOBALS[globalName];

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

    // console.log('instantiate', href);

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
          `${magicString.toString()}\n//# sourceURL=${requestHref}`
        );
        const pathname = new URL(href).pathname;

        __meta.cjsExport(module);

        return {
          setters: ctx.requires.map(_dep => (_m: any) => {
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

  async resolve(loader: System, href: string, parentHref?: string) {
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
}
