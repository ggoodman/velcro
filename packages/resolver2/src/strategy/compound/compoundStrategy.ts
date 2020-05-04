import { AbstractResolverStrategy, ResolverStrategy } from '../../strategy';
import { Uri } from '../../uri';
import { ResolverContext } from '../../context';

type StrategyMethodsNames = Extract<
  {
    [TKey in keyof ResolverStrategy]: { Key: TKey; Value: ResolverStrategy[TKey] };
  }[keyof ResolverStrategy],
  { Value: (...args: any[]) => any }
>['Key'];

interface ResolverHostFsOptions {
  strategies: ResolverStrategy[];
}

export class CompoundStrategy extends AbstractResolverStrategy {
  private readonly strategies: Set<ResolverStrategy>;

  constructor(options: ResolverHostFsOptions) {
    super();

    this.strategies = new Set(options.strategies);
  }

  private _delegateToStrategy<
    TMethodName extends StrategyMethodsNames,
    TMethod extends (...args: any) => any = ResolverStrategy[TMethodName]
  >(method: TMethodName, uri: Uri, ctx: ResolverContext): ReturnType<TMethod> {
    for (const strategy of this.strategies) {
      if (strategy.canResolve(uri)) {
        return strategy[method](uri, ctx) as ReturnType<TMethod>;
      }
    }

    return Promise.reject(
      new Error(`No strategy found whose root is a prefix of ${uri}`)
    ) as ReturnType<TMethod>;
  }

  canResolve(uri: Uri) {
    for (const strategy of this.strategies) {
      if (strategy.canResolve(uri)) {
        return true;
      }
    }

    return false;
  }

  getCanonicalUrl(uri: Uri, ctx: ResolverContext) {
    return this._delegateToStrategy('getCanonicalUrl', uri, ctx);
  }

  getResolveRoot(uri: Uri, ctx: ResolverContext) {
    return this._delegateToStrategy('getResolveRoot', uri, ctx);
  }

  getUrlForBareModule(name: string, spec: string, path: string, ctx: ResolverContext) {
    for (const strategy of this.strategies) {
      if (strategy.getUrlForBareModule) {
        return strategy.getUrlForBareModule(name, spec, path, ctx);
      }
    }
    return {
      found: false,
      uri: null,
    };
  }

  listEntries(uri: Uri, ctx: ResolverContext) {
    return this._delegateToStrategy('listEntries', uri, ctx);
  }

  readFileContent(uri: Uri, ctx: ResolverContext) {
    return this._delegateToStrategy('readFileContent', uri, ctx);
  }
}
