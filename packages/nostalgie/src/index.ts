//@ts-expect-error
import globalThis from '@velcro/node-libs/lib/global';
import { refresh } from './nostalgie';

if (!('document' in globalThis)) {
  throw new Error('Nostalgie must be run in the main thread of a browser');
}

globalThis.addEventListener('load', refresh);
