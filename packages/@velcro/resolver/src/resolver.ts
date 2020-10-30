import { CancellationTokenSource, PackageMainField, Uri } from '@velcro/common';
import { ResolverContext } from './context';
import type { ResolverStrategy } from './strategy';

export class Resolver {
  private disposed = false;
  readonly rootCtx: ResolverContext;
  private readonly settings: Resolver.Settings;
  private readonly strategy: ResolverStrategy;
  private readonly tokenSource = new CancellationTokenSource();

  constructor(strategy: ResolverStrategy, settings: Resolver.Settings) {
    this.settings = settings;
    this.strategy = strategy;
    this.rootCtx = ResolverContext.create(
      this,
      this.strategy,
      this.settings,
      this.tokenSource.token,
      { debug: settings.debug }
    );
  }

  decode(buf: BufferSource | string): string {
    if (typeof buf === 'string') {
      return buf;
    }

    return this.rootCtx.decoder.decode(buf);
  }

  dispose() {
    this.disposed = true;
    return this.rootCtx.dispose();
  }

  getCanonicalUrl(uri: string | Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.getCanonicalUrl', uri, (ctx) =>
      ctx.getCanonicalUrl(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  getResolveRoot(uri: string | Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.getResolveRoot', uri, (ctx) =>
      ctx.getResolveRoot(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  getSettings(uri: string | Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.getSettings', uri, (ctx) =>
      ctx.getSettings(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  getUrlForBareModule(name: string, spec: string, path: string) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext(
      'Resolver.getUrlForBareModule',
      `${name}|${spec}|${path}`,
      (ctx) => ctx.getUrlForBareModule(name, spec, path)
    );
  }

  invalidate(uri: string | Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.invalidate', uri, (ctx) =>
      ctx.invalidate(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  listEntries(uri: Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.listEntries', uri, (ctx) =>
      ctx.listEntries(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  readFileContent(uri: Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.readFileContent', uri, (ctx) =>
      ctx.readFileContent(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  readParentPackageJson(uri: Uri) {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    return this.rootCtx.runInIsolatedContext('Resolver.readParentPackageJson', uri, (ctx) =>
      ctx.readParentPackageJson(typeof uri === 'string' ? Uri.parse(uri) : uri)
    );
  }

  resolve(spec: Uri): ReturnType<ResolverContext['resolveDependency']>;
  resolve(spec: string, fromUri: Uri): ReturnType<ResolverContext['resolveDependency']>;
  resolve(spec: string | Uri, fromUri?: Uri): ReturnType<ResolverContext['resolveDependency']> {
    if (this.disposed) {
      throw new Error('Resolver has been disposed');
    }

    if (Uri.isUri(spec)) {
      return this.rootCtx.runInIsolatedContext('Resolver.resolveUri', spec, (ctx) =>
        ctx.resolveUri(spec)
      );
    }

    if (!fromUri) {
      throw new Error(
        'When calling Resolver.resolve with a string spec, a second "fromUri" argument is required'
      );
    }

    return this.rootCtx.runInIsolatedContext(
      'Resolver.resolve',
      `${fromUri ? fromUri.toString() : ''}|${spec}`,
      (ctx) => ctx.resolveDependency(spec, fromUri)
    );
  }
}

export namespace Resolver {
  export interface Settings {
    debug?: boolean;
    extensions: string[];
    packageMain: PackageMainField[];
  }
}
