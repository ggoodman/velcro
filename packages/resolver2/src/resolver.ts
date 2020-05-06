import { CancellationToken, CancellationTokenSource } from 'ts-primitives';
import { ResolverContext } from './context';
import { Decoder } from './decoder';
import { Settings } from './settings';
import { ResolverStrategy } from './strategy';

export interface ResolveOptions {
  ctx?: ResolverContext;
  token?: CancellationToken;
}

export class Resolver {
  readonly decoder = new Decoder();
  readonly settings: Settings;
  readonly strategy: ResolverStrategy;

  constructor(strategy: ResolverStrategy, settings: Settings) {
    this.settings = settings;
    this.strategy = strategy;
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
