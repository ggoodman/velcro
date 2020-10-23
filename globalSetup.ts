//@ts-ignore
import shimGlobalThis from 'globalthis/shim';

export default function globalSetup() {
  shimGlobalThis();
}
