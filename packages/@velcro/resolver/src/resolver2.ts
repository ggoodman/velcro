import type { CancellationToken, IDisposable, Uri } from '@velcro/common';
import { CancellationTokenSource, checkCancellation, isThenable } from '@velcro/common';
import type { ResolverContext } from './context';
import type { ResolverStrategy } from './strategy';

export const enum UrlEntryKind {
  Directory = 'directory',
  File = 'file',
}

export interface UrlEntry {
  uri: Uri;
  kind: UrlEntryKind;
}

export interface CreateBareModuleUrlResult {
  uri: Uri;
}

export interface GetCanonicalUrlResult {
  uri: Uri;
}

export interface GetResolveRootResult {
  uri: Uri;
}

export interface ListEntriesAtUrlResult {
  uri: Uri;
  entries: UrlEntry[];
}

export interface ReadFileContentResult {
  uri: Uri;
  content: ArrayBuffer;
}

export interface ResolveResult {
  found: boolean;
  uri: Uri | null;
}

export interface ResolverSettings {}

export interface ResolverOperation<T> extends IDisposable, PromiseLike<T> {
  readonly ctx: ResolverContext;
}

abstract class ResolverOperationImpl<T> implements ResolverOperation<T> {
  readonly ctx: ResolverContext;

  private promise: PromiseLike<T> | undefined = undefined;
  private readonly tokenSource: CancellationTokenSource;

  constructor(readonly strategy: ResolverStrategy, token?: CancellationToken) {
    this.tokenSource = new CancellationTokenSource(token);
    this.ctx = { token: this.tokenSource.token } as any;
  }

  get then() {
    if (!this.promise) {
      this.promise = this.invoke(this.strategy);
    }
    return this.promise.then;
  }

  dispose() {
    this.tokenSource.dispose(true);
  }

  abstract invoke(stratey: ResolverStrategy): PromiseLike<T>;
}

class CreateBareModuleUrlOperation extends ResolverOperationImpl<ResolveResult> {
  private readonly name: string;
  private readonly path: string;
  private readonly spec: string;
  constructor(
    name: string,
    spec: string,
    path: string,
    strategy: ResolverStrategy,
    token?: CancellationToken
  ) {
    super(strategy, token);

    this.name = name;
    this.spec = spec;
    this.path = path;
  }

  async invoke(strategy: ResolverStrategy) {
    if (!strategy.getUrlForBareModule) {
      throw new Error(
        `Unable to resolve bare module spec '${this.name}@${this.spec}${this.path}' because no strategy was found that supports resolving bare modules`
      );
    }

    return strategy.getUrlForBareModule(this.ctx, this.name, this.spec, this.path);
  }
}

export class Resolver {
  private readonly bareModuleUrlCache = new Map<string, ResolveResult>();

  constructor(
    private readonly strategy: ResolverStrategy,
    private readonly settings: ResolverSettings
  ) {}

  private createContext(
    operationName: string,
    cacheBucket: Map<string, unknown>,
    cacheKey: string
  ): ResolverContext {
    return {} as any;
  }

  dispose() {}

  createBareModuleUrl(name: string, spec: string, path: string): Promise<ResolveResult> {
    return new CreateBareModuleUrlOperation(name, spec, path);
  }

  async getCanonicalUrl(uri: Uri): Promise<GetCanonicalUrlResult> {
    // TODO: Actually construct a context
    const ctx: ResolverContext = {} as any;

    return this.strategy.getCanonicalUrl(ctx, uri);
  }

  async getResolveRoot(uri: Uri): Promise<GetResolveRootResult> {
    const tokenSource = new CancellationTokenSource();
    // TODO: Actually construct a context
    const ctx: ResolverContext = {
      token: tokenSource.token,
    } as any;

    const canonicalizationReturn = this.getCanonicalUrl(uri);
    const canonicalizationResult = isThenable(canonicalizationReturn)
      ? await checkCancellation(canonicalizationReturn, ctx.token)
      : canonicalizationReturn;

    return this.strategy.getResolveRoot(ctx, canonicalizationResult.uri);
  }

  async listEntriesAtUrl(uri: Uri): Promise<ListEntriesAtUrlResult> {
    const tokenSource = new CancellationTokenSource();
    // TODO: Actually construct a context
    const ctx: ResolverContext = {
      token: tokenSource.token,
    } as any;

    const canonicalizationReturn = this.getCanonicalUrl(uri);
    const canonicalizationResult = isThenable(canonicalizationReturn)
      ? await checkCancellation(canonicalizationReturn, ctx.token)
      : canonicalizationReturn;
    const listReturn = this.strategy.listEntries(ctx, canonicalizationResult.uri);
    const listResult = isThenable(listReturn)
      ? await checkCancellation(listReturn, ctx.token)
      : listReturn;

    return {
      uri: canonicalizationResult.uri,
      entries: listResult.entries,
    };
  }

  readFileContent(uri: Uri): Promise<ReadFileContentResult> {}

  resolveDependency(spec: string, fromUri: Uri): Promise<ResolveResult> {}

  resolveUrl(uri: Uri): Promise<ResolveResult> {}
}
