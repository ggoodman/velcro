import { CancellationToken, CancellationTokenSource } from 'ts-primitives';

import { ResolverContext } from './context';
import { ResolverStrategy } from './strategy';
import { Settings } from './settings';
import { Decoder } from './decoder';

export interface ResolveOptions {
  ctx?: ResolverContext;
  token?: CancellationToken;
}

// function uriFromRelativePair(spec: string, fromUri?: Uri | string): Uri {
//   if (typeof spec !== 'string') {
//     throw new TypeError(`The spec to be resolved must be a string, received ${typeof spec}`);
//   }

//   if (typeof fromUri === 'string') {
//     try {
//       fromUri = Uri.parse(fromUri);
//     } catch (err) {
//       throw new Error(
//         `Unable to resolve '${spec} from '${fromUri}' because the latter could not be parsed as a Uri`
//       );
//     }
//   } else if (Uri.isUri(fromUri)) {
//     try {
//       return Uri.joinPath(fromUri, spec);
//     } catch (err) {
//       throw new Error(`Unable to resolve '${spec}' relative to '${fromUri}': ${err.message}`);
//     }
//   } else if (fromUri) {
//     throw new TypeError(
//       `Unable to resolve '${spec}' because the 'fromUri' parameter is neither a Uri nor string`
//     );
//   }
//   try {
//     return Uri.parse(spec);
//   } catch {
//     try {
//       return Uri.file(spec);
//     } catch (err) {
//       throw new Error(`Could not construct a Uri from the spec '${spec}'`);
//     }
//   }
// }

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
