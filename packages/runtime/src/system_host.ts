import { Resolver } from '@velcro/resolver';
import MagicString from 'magic-string';

import { parse } from './ast';
import { isBareModuleSpecifier, parseBareModuleSpec } from './bare_modules';
import { SystemHost, System, Registration } from './system';
import { traverse } from './traverse';
import { isESModule } from './util';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from './visitors';
import { runLoaders } from './webpack_loader_runner';

const NODE_CORE_SHIMS: { [name: string]: string | (() => string | PromiseLike<string>) } = {
  assert: 'assert@1.4.1',
  buffer: 'buffer@5.2.1',
  crypto: 'crypto-browserify@3.12.0',
  events: 'events@3.0.0',
  fs: 'memory-fs',
  http: 'stream-http@3.0.0',
  https: 'https-browserify@1.0.0',
  // module: IGNORE_DEPENDENCY,
  net: 'node-libs-browser@2.2.0/mock/net.js',
  os: 'os-browserify@0.3.0',
  path: 'bfs-path@1.0.2',
  process: 'process@0.11.0',
  querystring: 'querystringify@2.1.0',
  stream: 'stream-browserify@2.0.2',
  tls: 'node-libs-browser@2.2.0/mock/tls.js',
  url: 'url-parse@1.4.4',
  util: 'util@0.11.0',
  vm: 'vmdom@0.0.23',
  zlib: 'browserify-zlib@0.2.0',
};
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

export class SystemHostUnpkg implements SystemHost {
  constructor(public readonly resolver: Resolver) {}

  async instantiate(loader: System, href: string, parentHref?: string) {
    const start = Date.now();
    const requestHref = href;
    try {
      let code: string;
      let url: URL;
      let loaders: string[] = [];

      const originalHref = href;
      const parts = href.split('!');

      if (parts.length > 1) {
        href = parts.pop() as string;
        loaders.push(...parts.filter(Boolean));
      }

      try {
        url = new URL(href);
      } catch (err) {
        // console.warn(originalHref, href, parentHref);
        throw new Error(`Error instantiating ${href} because it could not be resolved as a URL: ${err.message}`);
      }

      if (url.protocol === 'node:') {
        const shim = NODE_CORE_SHIMS[url.pathname];

        if (typeof shim !== 'function') {
          throw new Error('WAT');
        }

        code = await shim();
      } else {
        const codeBuf = await this.resolver.host.readFileContent(this.resolver, url);
        code = this.resolver.decoder.decode(codeBuf);
      }

      if (isESModule(code) && !loaders.length) {
        const sucraseLoaderUrl = await this.resolve(loader, '@sucrase/webpack-loader@2.0.0', requestHref);
        loaders = [sucraseLoaderUrl];
      }

      if (loaders.length) {
        const result = await runLoaders({
          loaders,
          resolver: this.resolver,
          systemLoader: loader,
          resource: url.href,
        });

        if (result.result && result.result.length) {
          const compiledResult = result.result[0];

          code = typeof compiledResult !== 'string' ? this.resolver.decoder.decode(compiledResult) : compiledResult;
        }
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
        traverse(ast, ctx, collectGlobalsVisitor);
      } catch (err) {
        throw new Error(`Error parsing ${href}: ${err.message}`);
      }

      const resolvedInjectPromises = [] as Promise<void>[];
      const resolvedRequirePromises = [] as Promise<void>[];
      const resolvedResolvePromises = [] as Promise<void>[];
      const requires = [] as string[];
      // const requireMappings = {} as { [key: string]: string };
      // const resolveMappings = {} as { [key: string]: string };

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
    } finally {
      // console.warn('instantiate(%s, %s): %d', href, parentHref, Date.now() - start);
    }
  }

  async resolve(loader: System, href: string, parentHref?: string) {
    const start = Date.now();
    try {
      let loaderPrefix = '';

      if (href.startsWith('!!')) {
        loaderPrefix = '!!';
        href = href.slice(2);
      } else if (href.startsWith('!')) {
        loaderPrefix = '!';
        href = href.slice(1);
      }

      if (parentHref) {
        parentHref = parentHref.split('!').find(Boolean);
      }

      if (!loaderPrefix && isBareModuleSpecifier(href)) {
        const parsedSpec = parseBareModuleSpec(href);

        let resolvedSpec: string | undefined = undefined;

        if (parsedSpec.spec) {
          // A manually-specified spec means we should use that instead of looking for a parent package.json
          resolvedSpec = href;
        } else if (parentHref) {
          let parentUrl: URL;

          try {
            parentUrl = new URL(parentHref);
          } catch (err) {
            throw new Error(
              `Error loading bare module ${href} because the parent module ${parentHref} could not be resolved to a URL`
            );
          }

          const parentPackageInfo = await this.resolver.readParentPackageJson(parentUrl);

          if (parentPackageInfo) {
            const consolidatedDependencies = {
              ...(parentPackageInfo.packageJson.peerDependencies || {}),
              ...(parentPackageInfo.packageJson.devDependencies || {}),
              ...(parentPackageInfo.packageJson.dependencies || {}),
            };

            const spec = consolidatedDependencies[parsedSpec.name];

            if (spec) {
              resolvedSpec = `${parsedSpec.name}@${spec}${parsedSpec.pathname}`;
            }
          }
        }

        if (resolvedSpec) {
          href = `https://unpkg.com/${resolvedSpec}`;
        } else if (!parentHref) {
          href = `https://unpkg.com/${href}`;
        } else if (NODE_CORE_SHIMS[href]) {
          let shim = NODE_CORE_SHIMS[href];

          if (typeof shim === 'function') {
            return `node:${href}`;
          } else {
            href = `https://unpkg.com/${NODE_CORE_SHIMS[href]}`;
          }
        } else {
          href = `https://unpkg.com/@kingjs/empty-object`;
        }
      }

      const parts = href.split('!');
      const resolvedPartsPromise = await Promise.all(
        parts.map(async href => {
          const url = new URL(href, parentHref);
          const resolved = await this.resolver.resolve(url);

          if (!resolved) {
            return new URL(`https://unpkg.com/@kingjs/empty-object`);
            throw new Error(`Failed to resolve ${href} from ${parentHref}`);
          }

          return resolved;
        })
      );
      const resolved = new URL(resolvedPartsPromise.join('!'));

      if (!loaderPrefix && parts.length === 1) {
        if (resolved.href.endsWith('.json')) {
          const styleLoaderHref = await loader.resolve('json-loader');

          return `${styleLoaderHref}!${resolved.href}`;
        }
        if (resolved.href.endsWith('.css')) {
          const [cssLoaderHref, styleLoaderHref] = await Promise.all([
            loader.resolve('css-loader'),
            loader.resolve('style-loader'),
          ]);

          return `${loaderPrefix}${styleLoaderHref}!${resolved.href}`;
        }
      }
      return `${loaderPrefix}${resolved.href}`;
    } finally {
      // console.warn('resolve(%s, %s): %d', href, parentHref, Date.now() - start);
    }
  }
}
