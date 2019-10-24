// export * from '@velcro/resolver';
// export * from '@velcro/resolver-host-unpkg';

export { CancellationToken, CancellationTokenSource } from 'ts-primitives';

export * from './asset';
export * from './bundler';
export * from './error';

export { getSourceMappingUrl } from './util';

import { Base64 } from 'js-base64';

export const base64 = {
  decode: Base64.decode,
  encode: Base64.encode,
};
