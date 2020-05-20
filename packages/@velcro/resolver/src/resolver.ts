import { PackageMainField, Uri } from '@velcro/common';
import { CancellationTokenSource } from 'ts-primitives';
import { ResolverContext } from './context';
import type { ResolverStrategy } from './strategy';

export namespace Resolver {
  export interface Settings {
    extensions: string[];
    packageMain: PackageMainField[];
  }
}

export class Resolver {
  // private readonly decoder = new Decoder();
  private readonly rootCtx: ResolverContext;
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
      this.tokenSource.token
    );
  }

  getCanonicalUrl(uri: string | Uri) {
    return this.rootCtx.getCanonicalUrl(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  getResolveRoot(uri: Uri) {
    return this.rootCtx.getResolveRoot(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  getSettings(uri: Uri) {
    return this.rootCtx.getSettings(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  getUrlForBareModule(name: string, spec: string, path: string) {
    return this.rootCtx.getUrlForBareModule(name, spec, path);
  }

  listEntries(uri: Uri) {
    return this.rootCtx.listEntries(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  readFileContent(uri: Uri) {
    return this.rootCtx.readFileContent(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  readParentPackageJson(uri: Uri) {
    return this.rootCtx.readParentPackageJson(typeof uri === 'string' ? Uri.parse(uri) : uri);
  }

  resolveBareModuleFrom(spec: string, fromUri: Uri) {
    return this.rootCtx.resolve(spec, fromUri);
  }

  createResolverContext() {
    const tokenSource = new CancellationTokenSource();

    return Object.assign(
      ResolverContext.create(this, this.strategy, this.settings, tokenSource.token),
      {
        dispose: tokenSource.dispose.bind(tokenSource, true),
      }
    );
  }
}
