import { ResolverContext } from '../../context';
import {
  AbstractResolverStrategy,
  ResolverStrategy,
  ResolverStrategyWithRoot,
} from '../../strategy';
import { Uri } from '../../util/uri';

type StrategyMethodsNames<
  TMethodName extends keyof ResolverStrategy =
    | 'getCanonicalUrl'
    | 'getResolveRoot'
    | 'getSettings'
    | 'listEntries'
    | 'readFileContent'
> = TMethodName;

interface ResolverHostFsOptions {
  strategies: ResolverStrategyWithRoot[];
}

export class CompoundStrategy extends AbstractResolverStrategy {
  private readonly strategies: Set<ResolverStrategyWithRoot>;

  constructor(options: ResolverHostFsOptions) {
    super();

    this.strategies = new Set(options.strategies);
  }

  private _delegateToStrategy<
    TMethodName extends StrategyMethodsNames,
    TMethod extends (ctx: ResolverContext, uri: Uri) => any = ResolverStrategy[TMethodName]
  >(method: TMethodName, ctx: ResolverContext, uri: Uri): ReturnType<TMethod> {
    for (const strategy of this.strategies) {
      if (Uri.isPrefixOf(strategy.rootUri, uri)) {
        return strategy[method](ctx, uri) as ReturnType<TMethod>;
      }
    }

    return Promise.reject(
      new Error(`No strategy found whose root is a prefix of ${uri}`)
    ) as ReturnType<TMethod>;
  }

  getCanonicalUrl(ctx: ResolverContext, uri: Uri) {
    return this._delegateToStrategy('getCanonicalUrl', ctx, uri);
  }

  getResolveRoot(ctx: ResolverContext, uri: Uri) {
    return this._delegateToStrategy('getResolveRoot', ctx, uri);
  }

  getUrlForBareModule(ctx: ResolverContext, name: string, spec: string, path: string) {
    for (const strategy of this.strategies) {
      if (strategy.getUrlForBareModule) {
        return strategy.getUrlForBareModule(ctx, name, spec, path);
      }
    }
    return {
      found: false,
      uri: null,
    };
  }

  listEntries(ctx: ResolverContext, uri: Uri) {
    return this._delegateToStrategy('listEntries', ctx, uri);
  }

  readFileContent(ctx: ResolverContext, uri: Uri) {
    return this._delegateToStrategy('readFileContent', ctx, uri);
  }
}
