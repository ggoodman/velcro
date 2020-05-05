import { dirname, Emitter, DisposableStore } from 'ts-primitives';

import { Uri } from '../uri';
import { Resolver } from '../resolver';
import {
  EntryExcludedError,
  EntryNotFoundError,
  DependencyNotFoundError,
  BuildError,
  isCanceledError,
} from '../error';
import { isThenable, checkCancellation } from '../async';
import { ResolverContext } from '../context';

import { parseBareModuleSpec, BareModuleSpec } from './bareModules';
import { MapSet } from './mapSet';
// import { parseFile } from './parser';
import { SourceModule } from './sourceModule';
import { SourceModuleDependency } from './sourceModuleDependency';
import { DEFAULT_SHIM_GLOBALS, NODE_CORE_SHIMS } from './shims';
import MagicString from 'magic-string';
import { parseFile } from './parser';

interface BundleOptions {
  entrypoints: Uri[];
  resolver: Resolver;
  nodeEnv?: string;
}

class Bundle {
  private readonly disposer = new DisposableStore();
  private readonly entrypoints: Uri[];
  private readonly errors = [] as { ctx: ResolverContext; err: Error }[];
  private readonly nodeEnv: string;
  private readonly resolver: Resolver;
  private readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
  private readonly sourceModules = new Map<string, SourceModule>();

  private readonly onErrorEmitter = new Emitter<{ ctx: ResolverContext; err: Error }>();

  constructor(options: BundleOptions) {
    this.resolver = options.resolver;
    this.entrypoints = options.entrypoints.map(Uri.from);
    this.nodeEnv = options.nodeEnv || 'development';

    this.disposer.add(
      this.onError((event) => {
        this.errors.push(event);
      })
    );
  }

  get onError() {
    return this.onErrorEmitter.event;
  }

  dispose() {
    this.disposer.dispose();
  }

  async build() {
    const disposer = new DisposableStore();
    this.disposer.add(disposer);

    const rootCtx = this.resolver.createResolverContext();
    disposer.add(rootCtx);

    const evt = this.onError(() => {
      disposer.dispose();
    });
    disposer.add(evt);

    for (const uri of this.entrypoints) {
      this.addUnresolvedUri(uri, rootCtx.withOperation('Bundle.addUnresolvedUri', uri));
    }

    try {
      // Flush the queue
      while (this.pendingModuleOperations.size) {
        await Promise.all(this.pendingModuleOperations.values());
      }
    } catch {
      throw this.buildError(this.errors.map((e) => e.err));
    }

    return this.sourceModules;
  }

  private addModuleDependency(
    sourceModule: SourceModule,
    dependency: SourceModuleDependency,
    ctx: ResolverContext
  ) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const operation = this.resolveDependency(sourceModule, dependency, ctx);

    operation.then(
      () => {
        this.pendingModuleOperations.delete(sourceModule.href, operation);
      },
      (err) => {
        this.pendingModuleOperations.delete(sourceModule.href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(sourceModule.href, operation);
  }

  private addResolvedUri(uri: Uri, rootUri: Uri, ctx: ResolverContext) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    this.readSourceAndCreateModule(
      uri,
      rootUri,
      ctx.withOperation('Bundle.readSourceAndCreateModule', uri)
    );
  }

  private addUnresolvedUri(uri: Uri, ctx: ResolverContext) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = this.addUnresolvedUriImpl(
      uri,
      ctx.withOperation('Bundler.addUnresolvedUriImpl', uri)
    );

    operation.then(
      () => {
        this.pendingModuleOperations.delete(href, operation);
      },
      (err) => {
        this.pendingModuleOperations.delete(href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(href, operation);
  }

  private async addUnresolvedUriImpl(uri: Uri, ctx: ResolverContext) {
    const resolveResult = await ctx.resolve(uri);

    if (!resolveResult.found) {
      throw new EntryNotFoundError(`Entry point not found: ${uri}`);
    }

    if (!resolveResult.uri) {
      throw new EntryExcludedError(uri);
    }

    this.addResolvedUri(resolveResult.uri, resolveResult.rootUri, ctx);
  }

  private buildError(errors: Error[]) {
    return new BuildError(errors);
  }

  private readSourceAndCreateModule(uri: Uri, rootUri: Uri, ctx: ResolverContext) {
    if (ctx.token.isCancellationRequested) {
      return;
    }

    const href = uri.toString();
    const operation = this.readSourceAndCreateModuleImpl(
      uri,
      rootUri,
      ctx.withOperation('Bundler.readSourceAndCreateModuleImpl', uri)
    );

    operation.then(
      () => {
        this.pendingModuleOperations.delete(href, operation);
      },
      (err) => {
        this.pendingModuleOperations.delete(href, operation);
        if (!isCanceledError(err)) {
          this.onErrorEmitter.fire({ ctx, err });
        }
      }
    );

    this.pendingModuleOperations.add(href, operation);
  }

  private async readSourceAndCreateModuleImpl(uri: Uri, rootUri: Uri, ctx: ResolverContext) {
    const href = uri.toString();
    ctx.debug(`%s.readAndParse(%s)`, this.constructor.name, href);
    const contentReturn = ctx.readFileContent(uri);
    const contentResult = isThenable(contentReturn)
      ? await checkCancellation(contentReturn, ctx.token)
      : contentReturn;
    const code = ctx.decoder.decode(contentResult.content);
    console.time(`parseFile(${href})`);

    const parsedResult = parseFile(href, code, {
      nodeEnv: this.nodeEnv,
    });
    // const parsedResult = parseFile(href, code, {
    //   nodeEnv: this.nodeEnv,
    // });
    console.timeEnd(`parseFile(${href})`);
    const dependencies = new Set<SourceModuleDependency>();

    const requiresBySpec = new Map<string, Array<{ start: number; end: number }>>();
    for (const requireDependency of parsedResult.requireDependencies) {
      let locations = requiresBySpec.get(requireDependency.spec.value);
      if (!locations) {
        locations = [];
        requiresBySpec.set(requireDependency.spec.value, locations);
      }

      locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
    }
    for (const [spec, locations] of requiresBySpec) {
      dependencies.add(SourceModuleDependency.fromRequire(spec, locations));
    }

    const requireResolvesBySpec = new Map<string, Array<{ start: number; end: number }>>();
    for (const requireDependency of parsedResult.requireResolveDependencies) {
      let locations = requiresBySpec.get(requireDependency.spec.value);
      if (!locations) {
        locations = [];
        requiresBySpec.set(requireDependency.spec.value, locations);
      }

      locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
    }
    for (const [spec, locations] of requireResolvesBySpec) {
      dependencies.add(SourceModuleDependency.fromRequireResolve(spec, locations));
    }

    for (const [symbolName, locations] of parsedResult.unboundSymbols) {
      const shim = DEFAULT_SHIM_GLOBALS[symbolName];

      if (shim) {
        dependencies.add(
          SourceModuleDependency.fromGloblaObject(shim.spec, locations, shim.export)
        );
      }
    }

    const sourceModule = new SourceModule(
      uri,
      rootUri,
      new MagicString(code, { filename: href, indentExclusionRanges: [] }),
      dependencies
    );
    this.sourceModules.set(sourceModule.href, sourceModule);

    for (const dependency of sourceModule.dependencies) {
      this.addModuleDependency(
        sourceModule,
        dependency,
        ctx.withOperation('Bundler.addModuleDependency', uri)
      );
    }
  }

  private async resolveDependency(
    sourceModule: SourceModule,
    dependency: SourceModuleDependency,
    ctx: ResolverContext
  ) {
    const parsedSpec = parseBareModuleSpec(dependency.spec);
    const resolveReturn = parsedSpec
      ? this.resolveBareModule(
          sourceModule,
          parsedSpec,
          ctx.withOperation('Bundle.resolveBareModule', sourceModule.uri)
        )
      : this.resolveRelativeUri(
          sourceModule,
          dependency.spec,
          ctx.withOperation('Bundle.resolveRelativeUri', sourceModule.uri)
        );
    const resolveResult = isThenable(resolveReturn)
      ? await checkCancellation(resolveReturn, ctx.token)
      : resolveReturn;

    sourceModule.setUriForDependency(dependency, resolveResult.uri);

    const href = resolveResult.uri.toString();

    // To avoid circularity
    if (this.sourceModules.has(href)) {
      return;
    }

    // If we already have pending operations for the same Uri, we can
    // assume that the module either already exists or soon will and
    // should not be re-read.
    if (this.pendingModuleOperations.has(href)) {
      return;
    }

    this.addResolvedUri(
      resolveResult.uri,
      resolveResult.rootUri,
      ctx.withOperation('Bundle.addResolvedUri', resolveResult.uri)
    );
  }

  private async resolveRelativeUri(
    sourceModule: SourceModule,
    pathname: string,
    ctx: ResolverContext
  ) {
    ctx.debug(`bundler.resolveRelativeUri(%s, %s)`, pathname, sourceModule.href);

    const uri = Uri.joinPath(
      Uri.from({
        ...sourceModule.uri,
        path: dirname(sourceModule.uri.path),
      }),
      pathname
    );
    const resolveReturn = ctx.resolve(uri);
    const resolveResult = isThenable(resolveReturn)
      ? await checkCancellation(resolveReturn, ctx.token)
      : resolveReturn;

    if (!resolveResult.found) {
      throw new DependencyNotFoundError(pathname, sourceModule);
    }

    if (!resolveResult.uri) {
      // TODO: Inject empty module
      throw new EntryExcludedError(pathname);
    }

    return {
      uri: resolveResult.uri,
      rootUri: resolveResult.rootUri,
    };
  }

  private async resolveBareModule(
    sourceModule: SourceModule,
    parsedSpec: BareModuleSpec,
    ctx: ResolverContext
  ) {
    ctx.debug(
      `bundler.resolveBareModule(%s%s, %s)`,
      parsedSpec.nameSpec,
      parsedSpec.path,
      sourceModule.href
    );
    let locatorName = parsedSpec.name;
    let locatorSpec = parsedSpec.spec;
    let locatorPath = parsedSpec.path;

    if (!locatorSpec) {
      const parentPackageJsonReturn = ctx.readParentPackageJson(sourceModule.uri);
      const parentPackageJsonResult = isThenable(parentPackageJsonReturn)
        ? await checkCancellation(parentPackageJsonReturn, ctx.token)
        : parentPackageJsonReturn;

      if (!parentPackageJsonResult.found) {
        throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
      }

      const dependencies = {
        ...(parentPackageJsonResult.packageJson.peerDependencies || {}),
        ...(parentPackageJsonResult.packageJson.devDependencies || {}),
        ...(parentPackageJsonResult.packageJson.dependencies || {}),
      };

      locatorSpec = dependencies[parsedSpec.name];
    }

    if (!locatorSpec) {
      const builtIn = NODE_CORE_SHIMS[parsedSpec.name];

      if (builtIn) {
        locatorName = builtIn.name;
        locatorSpec = builtIn.spec;
        locatorPath = builtIn.path;
      }
    }

    if (!locatorSpec) {
      throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
    }

    const bareModuleUriReturn = ctx.getUrlForBareModule(locatorName, locatorSpec, locatorPath);
    const bareModuleUriResult = isThenable(bareModuleUriReturn)
      ? await checkCancellation(bareModuleUriReturn, ctx.token)
      : bareModuleUriReturn;

    if (!bareModuleUriResult.found) {
      throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
    }

    if (!bareModuleUriResult.uri) {
      // TODO: Inject empty module
      throw new EntryExcludedError(parsedSpec.nameSpec);
    }

    const resolveReturn = ctx.resolve(bareModuleUriResult.uri);
    const resolveResult = isThenable(resolveReturn)
      ? await checkCancellation(resolveReturn, ctx.token)
      : resolveReturn;

    if (!resolveResult.found) {
      throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
    }

    if (!resolveResult.uri) {
      // TODO: Inject empty module
      throw new EntryExcludedError(parsedSpec.nameSpec);
    }

    return {
      uri: resolveResult.uri,
      rootUri: resolveResult.rootUri,
    };
  }
}

interface CreateBundleOptions {
  entrypoints: Uri[];
  resolver: Resolver;
  nodeEnv?: string;
}
export function createBundle(options: CreateBundleOptions) {
  const bundle = new Bundle(options);

  return bundle.build();
}

// export class Bundler {
//   readonly errors = [] as Error[];
//   readonly pendingModuleOperations = new MapSet<string, Promise<unknown>>();
//   readonly resolver: Resolver;
//   readonly rootCtx: ResolverContext;
//   readonly sourceModules = new Map<string, SourceModule>();
//   tokenSource = new CancellationTokenSource();

//   constructor(resolver: Resolver, readonly nodeEnv = 'development') {
//     this.resolver = resolver;
//     this.rootCtx = resolver.createResolverContext();
//   }

//   async add(uri: Uri) {
//     const ctx = this.rootCtx.withOperation(`${this.constructor.name}.add`, uri);

//     ctx.debug('addUnresolved(%s)', uri);

//     const resolveResult = await ctx.resolve(uri);

//     if (!resolveResult.found) {
//       throw new EntryNotFoundError(`Entry point not found: ${uri}`);
//     }

//     if (!resolveResult.uri) {
//       throw new EntryExcludedError(uri);
//     }

//     this.onModuleUriDiscovered(resolveResult.uri, resolveResult.rootUri);

//     while (this.pendingModuleOperations.size) {
//       await Promise.all(this.pendingModuleOperations.values());
//     }

//     // Build graph
//     const sourceModulesByRoot = new MapSet<string, SourceModule>();

//     for (const sourceModule of this.sourceModules.values()) {
//       sourceModulesByRoot.add(sourceModule.rootHref, sourceModule);
//     }

//     console.log(sourceModulesByRoot);
//   }

//   private onModuleUriDiscovered(uri: Uri, rootUri: Uri) {
//     const href = uri.toString();

//     if (this.sourceModules.has(href)) {
//       return;
//     }

//     // If we already have pending operations for the same Uri, we can
//     // assume that the module either already exists or soon will and
//     // should not be re-read.
//     if (this.pendingModuleOperations.has(href)) {
//       return;
//     }

//     this.onModuleRequiresReading(uri, rootUri);
//   }

//   private onModuleDependencyDiscovered(
//     sourceModule: SourceModule,
//     dependency: SourceModuleDependency
//   ) {
//     const method = this.resolveDependency;
//     const ctx = this.rootCtx.withOperation(
//       `${this.constructor.name}.${method.name}`,
//       sourceModule.href
//     );
//     const operation = this.resolveDependency(sourceModule, dependency, ctx);

//     operation.then(
//       () => {
//         this.pendingModuleOperations.delete(sourceModule.href, operation);
//       },
//       (err) => {
//         this.errors.push(err);
//         ctx.dispose();
//         this.pendingModuleOperations.delete(sourceModule.href, operation);
//       }
//     );

//     this.pendingModuleOperations.add(sourceModule.href, operation);
//   }

//   private onModuleRequiresReading(uri: Uri, rootUri: Uri) {
//     const href = uri.toString();
//     const method = this.readAndParse;
//     const ctx = this.rootCtx.withOperation(`${this.constructor.name}.${method.name}`, uri);
//     const operation = this.readAndParse(uri, rootUri, ctx);

//     operation.then(
//       () => {
//         this.pendingModuleOperations.delete(href, operation);
//       },
//       (err) => {
//         this.errors.push(err);
//         ctx.dispose();
//         this.pendingModuleOperations.delete(href, operation);
//       }
//     );

//     this.pendingModuleOperations.add(href, operation);
//   }

//   private async readAndParse(uri: Uri, rootUri: Uri, ctx: ResolverContext) {
//     const href = uri.toString();
//     ctx.debug(`%s.readAndParse(%s)`, this.constructor.name, href);
//     const contentReturn = ctx.readFileContent(uri);
//     const contentResult = isThenable(contentReturn) ? await contentReturn : contentReturn;
//     const code = ctx.decoder.decode(contentResult.content);
//     const parsedResult = parseFile(href, code, {
//       nodeEnv: this.nodeEnv,
//     });
//     const dependencies = new Set<SourceModuleDependency>();

//     const requiresBySpec = new Map<string, Array<{ start: number; end: number }>>();
//     for (const requireDependency of parsedResult.requireDependencies) {
//       let locations = requiresBySpec.get(requireDependency.spec.value);
//       if (!locations) {
//         locations = [];
//         requiresBySpec.set(requireDependency.spec.value, locations);
//       }

//       locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
//     }
//     for (const [spec, locations] of requiresBySpec) {
//       dependencies.add(SourceModuleDependency.fromRequire(spec, locations));
//     }

//     const requireResolvesBySpec = new Map<string, Array<{ start: number; end: number }>>();
//     for (const requireDependency of parsedResult.requireResolveDependencies) {
//       let locations = requiresBySpec.get(requireDependency.spec.value);
//       if (!locations) {
//         locations = [];
//         requiresBySpec.set(requireDependency.spec.value, locations);
//       }

//       locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
//     }
//     for (const [spec, locations] of requireResolvesBySpec) {
//       dependencies.add(SourceModuleDependency.fromRequireResolve(spec, locations));
//     }

//     for (const [symbolName, locations] of parsedResult.unboundSymbols) {
//       const shim = DEFAULT_SHIM_GLOBALS[symbolName];

//       if (shim) {
//         dependencies.add(
//           SourceModuleDependency.fromGloblaObject(shim.spec, locations, shim.export)
//         );
//       }
//     }

//     const sourceModule = new SourceModule(uri, rootUri, parsedResult.magicString, dependencies);
//     this.sourceModules.set(sourceModule.href, sourceModule);

//     for (const dependency of sourceModule.dependencies) {
//       this.onModuleDependencyDiscovered(sourceModule, dependency);
//     }
//   }

//   private async resolveDependency(
//     sourceModule: SourceModule,
//     dependency: SourceModuleDependency,
//     ctx: ResolverContext
//   ) {
//     const parsedSpec = parseBareModuleSpec(dependency.spec);
//     const resolveReturn = parsedSpec
//       ? this.resolveBareModule(sourceModule, parsedSpec, ctx)
//       : this.resolveRelativeUri(sourceModule, dependency.spec, ctx);
//     const resolveResult = isThenable(resolveReturn) ? await resolveReturn : resolveReturn;

//     sourceModule.setUriForDependency(dependency, resolveResult.uri);

//     this.onModuleUriDiscovered(resolveResult.uri, resolveResult.rootUri);
//   }

//   private async resolveRelativeUri(
//     sourceModule: SourceModule,
//     pathname: string,
//     ctx: ResolverContext
//   ) {
//     ctx.debug(`bundler.resolveRelativeUri(%s, %s)`, pathname, sourceModule.href);

//     const uri = Uri.joinPath(
//       Uri.from({
//         ...sourceModule.uri,
//         path: dirname(sourceModule.uri.path),
//       }),
//       pathname
//     );
//     const resolveReturn = ctx.resolve(uri);
//     const resolveResult = isThenable(resolveReturn) ? await resolveReturn : resolveReturn;

//     if (!resolveResult.found) {
//       throw new DependencyNotFoundError(pathname, sourceModule);
//     }

//     if (!resolveResult.uri) {
//       // TODO: Inject empty module
//       throw new EntryExcludedError(pathname);
//     }

//     return {
//       uri: resolveResult.uri,
//       rootUri: resolveResult.rootUri,
//     };
//   }

//   private async resolveBareModule(
//     sourceModule: SourceModule,
//     parsedSpec: BareModuleSpec,
//     ctx: ResolverContext
//   ) {
//     ctx.debug(
//       `bundler.resolveBareModule(%s%s, %s)`,
//       parsedSpec.nameSpec,
//       parsedSpec.path,
//       sourceModule.href
//     );
//     let locatorName = parsedSpec.name;
//     let locatorSpec = parsedSpec.spec;
//     let locatorPath = parsedSpec.path;

//     if (!locatorSpec) {
//       const parentPackageJsonReturn = ctx.readParentPackageJson(sourceModule.uri);
//       const parentPackageJsonResult = isThenable(parentPackageJsonReturn)
//         ? await parentPackageJsonReturn
//         : parentPackageJsonReturn;

//       if (!parentPackageJsonResult.found) {
//         throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
//       }

//       const dependencies = {
//         ...(parentPackageJsonResult.packageJson.peerDependencies || {}),
//         ...(parentPackageJsonResult.packageJson.devDependencies || {}),
//         ...(parentPackageJsonResult.packageJson.dependencies || {}),
//       };

//       locatorSpec = dependencies[parsedSpec.name];
//     }

//     if (!locatorSpec) {
//       const builtIn = NODE_CORE_SHIMS[parsedSpec.name];

//       if (builtIn) {
//         locatorName = builtIn.name;
//         locatorSpec = builtIn.spec;
//         locatorPath = builtIn.path;
//       }
//     }

//     if (!locatorSpec) {
//       throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule.uri);
//     }

//     const bareModuleUriReturn = ctx.getUrlForBareModule(locatorName, locatorSpec, locatorPath);
//     const bareModuleUriResult = isThenable(bareModuleUriReturn)
//       ? await bareModuleUriReturn
//       : bareModuleUriReturn;

//     if (!bareModuleUriResult.found) {
//       throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
//     }

//     if (!bareModuleUriResult.uri) {
//       // TODO: Inject empty module
//       throw new EntryExcludedError(parsedSpec.nameSpec);
//     }

//     const resolveReturn = ctx.resolve(bareModuleUriResult.uri);
//     const resolveResult = isThenable(resolveReturn) ? await resolveReturn : resolveReturn;

//     if (!resolveResult.found) {
//       throw new DependencyNotFoundError(parsedSpec.nameSpec, sourceModule);
//     }

//     if (!resolveResult.uri) {
//       // TODO: Inject empty module
//       throw new EntryExcludedError(parsedSpec.nameSpec);
//     }

//     return {
//       uri: resolveResult.uri,
//       rootUri: resolveResult.rootUri,
//     };
//   }
// }
