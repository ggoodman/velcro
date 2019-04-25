// import { Resolver } from '@velcro/resolver';
// import MagicString from 'magic-string';

// import { parse } from './ast';
// import { isBareModuleSpecifier } from './bare_modules';
// import { SystemHost, System, Registration } from './system';
// import { traverse } from './traverse';
// import { ICache, BareModuleResolver, GlobalInjector, CacheSegment } from './types';
// import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from './visitors';
// import { runLoaders, parseLoaderSpec, parseLoaderHref, serializeLoaderHref } from './webpack_loader_runner';
// import { injectUnresolvedFallback } from './util';

// export interface SystemHostUnpkgOptions {
//   cache?: ICache;
//   enableSourceMaps?: boolean;
//   injectGlobal?: GlobalInjector;
//   resolveBareModule: BareModuleResolver;
// }

// export class SystemHostUnpkg implements SystemHost {
//   private readonly enableSourceMaps: boolean;
//   private readonly resolveBareModule: BareModuleResolver;
//   private readonly injectGlobal: GlobalInjector | undefined;

//   private readonly inflightInstantiations = new Map<string, Promise<Registration>>();
//   private readonly inflightResolutions = new Map<string, Promise<string>>();

//   constructor(public readonly resolver: Resolver, options: SystemHostUnpkgOptions) {
//     this.resolveBareModule = options.resolveBareModule;
//     this.injectGlobal = options.injectGlobal;
//     this.enableSourceMaps = options.enableSourceMaps === true;
//   }

//   private async instantiateWithoutCache(
//     loader: System,
//     href: string,
//     parentHref?: string
//   ): Promise<{ cacheable: boolean; registration: { href: string; code: string; requires: string[] } }> {
//     let cacheable = true;
//     let code: string | undefined = undefined;

//     let parsedHref = parseLoaderHref(href);

//     if (!parsedHref) {
//       if (href.endsWith('.css')) {
//         const loaderHref = await loader.resolve(
//           serializeLoaderHref({
//             loaders: ['style-loader', 'css-loader'],
//             resource: href,
//             query: '',
//           })
//         );

//         parsedHref = parseLoaderHref(loaderHref);

//         if (!parsedHref) {
//           throw new Error(`Loader failed to produce a parsable loader href ${loaderHref} for ${href}`);
//         }
//       }
//     }

//     if (parsedHref) {
//       const result = await runLoaders({
//         loaders: parsedHref.loaders,
//         resolver: this.resolver,
//         resource: parsedHref.resource,
//         systemLoader: loader,
//       });

//       cacheable = result.cacheable;

//       if (result.result) {
//         const [codeVal] = result.result;
//         code = typeof codeVal === 'string' ? codeVal : this.resolver.decoder.decode(codeVal);
//       } else {
//         throw new Error(`Loaders failed to produce code for ${href}`);
//       }
//     } else {
//       let url: URL;

//       try {
//         url = new URL(href, parentHref);
//       } catch (err) {
//         throw new Error(`Unable to instantiate ${href} because this could not be parsed as a URL`);
//       }

//       const codeBuf = await this.resolver.host.readFileContent(this.resolver, url);
//       code = this.resolver.decoder.decode(codeBuf);
//     }

//     const magicString = new MagicString(code, {
//       filename: href,
//       indentExclusionRanges: [],
//     });
//     const requires = [] as string[];

//     if (href.endsWith('.json')) {
//       magicString.prepend('"use strict";\nmodule.exports = ');
//     } else {
//       const ctx: DependencyVisitorContext = {
//         injectGlobals: new Set(),
//         locals: new Map(),
//         nodeEnv: 'development',
//         replacements: [],
//         requires: [],
//         resolves: [],
//         skip: new Set(),
//       };

//       try {
//         const ast = parse(code);

//         traverse(ast, ctx, scopingAndRequiresVisitor);

//         if (this.injectGlobal) {
//           traverse(ast, ctx, collectGlobalsVisitor);
//         }
//       } catch (err) {
//         throw new Error(`Error parsing ${href}: ${err.message}`);
//       }

//       const resolvedInjectPromises = [] as Promise<void>[];
//       const resolvedRequirePromises = [] as Promise<void>[];
//       const resolvedResolvePromises = [] as Promise<void>[];

//       if (this.injectGlobal) {
//         for (const globalName of ctx.injectGlobals) {
//           const injectGlobal = this.injectGlobal(globalName);

//           if (injectGlobal) {
//             resolvedInjectPromises.push(
//               Promise.resolve(loader.resolve(injectGlobal.spec, href)).then(resolvedHref => {
//                 const injected = `var ${globalName} = require(${JSON.stringify(resolvedHref)});\n`;
//                 magicString.prepend(injected);
//                 requires.push(resolvedHref);
//               })
//             );
//           }
//         }
//       }

//       for (const dep of ctx.requires) {
//         // Hook into the resolution of each require dependency found inline
//         // in code.
//         const parsedDep = parseLoaderSpec(dep.value);
//         let value = dep.value;

//         if (parsedDep) {
//           // This is a loader, let's transform it into our url format

//           value = serializeLoaderHref(parsedDep);
//         }

//         resolvedRequirePromises.push(
//           Promise.resolve(loader.resolve(value, href)).then(async resolvedHref => {
//             magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
//             requires.push(resolvedHref);
//           })
//         );
//       }

//       for (const dep of ctx.resolves) {
//         resolvedResolvePromises.push(
//           Promise.resolve(loader.resolve(dep.value, href)).then(resolvedHref => {
//             magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
//           })
//         );
//       }

//       const promises = [...resolvedInjectPromises, ...resolvedRequirePromises, ...resolvedResolvePromises];

//       if (promises.length) {
//         await Promise.all(promises);
//       }

//       for (const replacement of ctx.replacements) {
//         magicString.overwrite(replacement.start, replacement.end, replacement.replacement);
//       }
//     }

//     const codeWithSourceMap = this.enableSourceMaps
//       ? `${magicString.toString()}\n//# sourceMappingURL=${magicString
//           .generateMap({
//             includeContent: false,
//             source: href,
//           })
//           .toUrl()}`
//       : magicString.toString();

//     return {
//       cacheable,
//       registration: { href, code: codeWithSourceMap, requires },
//     };
//   }

//   async invalidateResolve(_loader: System, _resolvedHref: string, href: string, parentHref?: string) {
//     console.debug('invalidateResolve', href, parentHref);
//     if (this.cache) {
//       await this.cache.delete(CacheSegment.Resolve, getResolveCacheKey(href, parentHref));
//     }
//   }

//   async invalidateModule(_loader: System, href: string) {
//     console.debug('invalidateModule', href);
//     if (this.cache) {
//       await this.cache.delete(CacheSegment.Instantiate, href);
//     }
//   }

//   private async resolveWithoutCache(
//     loader: System,
//     href: string,
//     parentHref?: string
//   ): Promise<{ cacheable: boolean; id: string }> {
//     const loaderSpec = parseLoaderHref(href);
//     const parentLoaderSpec = parentHref ? parseLoaderHref(parentHref) : undefined;

//     if (loaderSpec || parentLoaderSpec) {
//       // We're resolving something related to webpack loaders

//       const query = loaderSpec ? loaderSpec.query : '';

//       let resource = loaderSpec ? loaderSpec.resource : href;
//       let loaders = loaderSpec
//         ? await Promise.all(loaderSpec.loaders.map(spec => loader.resolve(spec, parentHref)))
//         : [];

//       // 1. The main 'resource' is relative
//       if (resource.startsWith('.')) {
//         if (parentLoaderSpec) {
//           resource = new URL(resource, parentLoaderSpec.loaders[0] || parentLoaderSpec.resource).href;
//         }
//       }

//       const id = serializeLoaderHref({ loaders, query, resource });

//       return {
//         cacheable: false,
//         id,
//       };
//     }

//     let id = isBareModuleSpecifier(href)
//       ? await this.resolveBareModule(loader, this.resolver, href, parentHref)
//       : undefined;

//     if (!id) {
//       const url = new URL(href, parentHref);
//       const resolved = await this.resolver.resolve(url);

//       if (resolved) {
//         id = resolved.href;
//       }
//     }

//     if (!id) {
//       return {
//         cacheable: false,
//         id: injectUnresolvedFallback(loader, href, parentHref),
//       };
//     }

//     return {
//       cacheable: true,
//       id,
//     };
//   }

//   async instantiate(loader: System, href: string, parentHref?: string) {
//     const cacheKey = href;
//     let inflightInstantiation = this.inflightInstantiations.get(cacheKey);

//     if (!inflightInstantiation) {
//       inflightInstantiation = (async () => {
//         let registration: Registration | undefined = undefined;

//         if (this.cache) {
//           const cached = (await this.cache.get(CacheSegment.Instantiate, cacheKey)) as {
//             code: string;
//             href: string;
//             requires: string[];
//           };

//           if (cached) {
//             registration = createRegistration(cached.href, cached.code, cached.requires);
//           }
//         }

//         if (!registration) {
//           const result = await this.instantiateWithoutCache(loader, href, parentHref);

//           if (result.cacheable && this.cache) {
//             await this.cache.set(CacheSegment.Instantiate, cacheKey, result.registration);
//           }

//           registration = createRegistration(
//             result.registration.href,
//             result.registration.code,
//             result.registration.requires
//           );
//         }

//         return registration;
//       })();

//       this.inflightInstantiations.set(cacheKey, inflightInstantiation);
//     }

//     try {
//       return await inflightInstantiation;
//     } finally {
//       this.inflightInstantiations.delete(cacheKey);
//     }
//   }

//   async resolve(loader: System, href: string, parentHref?: string) {
//     const cacheKey = getResolveCacheKey(href, parentHref);

//     let inflightResolution = this.inflightResolutions.get(cacheKey);

//     if (!inflightResolution) {
//       inflightResolution = (async () => {
//         if (this.cache) {
//           const cached = await this.cache.get(CacheSegment.Resolve, cacheKey);

//           if (cached) {
//             return cached as string;
//           }
//         }

//         const result = await this.resolveWithoutCache(loader, href, parentHref);

//         if (result && result.cacheable && this.cache) {
//           await this.cache.set(CacheSegment.Resolve, cacheKey, result.id);
//         }

//         return result.id;
//       })();

//       this.inflightResolutions.set(cacheKey, inflightResolution);
//     }

//     try {
//       return await inflightResolution;
//     } finally {
//       this.inflightResolutions.delete(cacheKey);
//     }
//   }
// }

// function createRegistration(href: string, code: string, requires: string[]): Registration {
//   const registration: Registration = [
//     requires,
//     function(__export, __meta) {
//       // console.log('register', href);

//       const require = Object.assign(
//         function require(id: string) {
//           // console.warn('require(%s): %s', id, href);
//           return __meta.cjsRequire(id);
//         },
//         {
//           resolve(id: string) {
//             return id;
//           },
//         }
//       );
//       const exports = {};
//       const module = { exports };
//       // const map = magicString.generateMap({});
//       const execute = new Function(
//         'exports',
//         'require',
//         'module',
//         '__filename',
//         '__dirname',
//         `${code}\n//# sourceURL=${href}`
//       );
//       const __dirname = Resolver.path.dirname(href);
//       const __filename = Resolver.path.basename(href);

//       __meta.cjsExport(module);

//       return {
//         setters: requires.map(_dep => (_m: any) => {
//           // console.log('setter', dep, m);
//         }),
//         execute() {
//           // console.log('execute', href);
//           try {
//             execute.call(module, module.exports, require, module, __filename, __dirname);
//           } catch (err) {
//             const wrappedErr = new Error(`Error while executing ${href}: ${err.message}`);
//             Object.defineProperty(wrappedErr, 'stack', {
//               get() {
//                 return err.stack;
//               },
//             });

//             throw wrappedErr;
//           }
//         },
//       };
//     },
//   ];

//   return registration;
// }

// function getResolveCacheKey(href: string, parentHref?: string) {
//   return `${href}|${parentHref}`;
// }
