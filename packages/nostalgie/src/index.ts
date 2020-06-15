import { refresh } from './nostalgie';

if (!('document' in globalThis)) {
  throw new Error('Nostalgie must be run in the main thread of a browser');
}

globalThis.addEventListener('load', refresh);
