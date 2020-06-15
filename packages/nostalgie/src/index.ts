import { refresh } from './nostalgie';

if (typeof window !== 'object' || !('document' in window)) {
  throw new Error('Nostalgie must be run in the main thread of a browser');
}

window.addEventListener('load', refresh);
