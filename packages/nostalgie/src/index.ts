import { getCurrentScript } from 'tiny-current-script';
import { refresh } from './nostalgie';

const scriptTag = getCurrentScript();
if (!scriptTag) {
  console.warn('Nostalgie was unable to determine the current script tag and will not run.');
} else {
  refresh([scriptTag]);
}
