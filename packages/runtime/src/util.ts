import { System } from './system';

const IMPORT_EXPORT_RX = /(;|^)(import|export)(\s|{)/gm;

export function injectUnresolvedFallback(system: System, href: string, parentHref?: string) {
  const fallbackUrl = new URL(href, parentHref);
  const fallbackHref = fallbackUrl.href;
  const proxyTarget = Object.create(null);
  const proxyHandler: ProxyHandler<typeof proxyTarget> = {
    apply(_target, _thisArg, argArray) {
      throw new Error(
        `Attempting to invoke the exports of a module that could not be resolved: ${href}${
          parentHref ? ` from ${parentHref}` : ''
        } with arguments: ${argArray.join(', ')}`
      );
    },
    construct(_target, argArray, _newTarget) {
      throw new Error(
        `Attempting to construct the exports of a module that could not be resolved: ${href}${
          parentHref ? ` from ${parentHref}` : ''
        } with arguments: ${argArray.join(', ')}`
      );
    },
  };
  const fallbackModule = typeof Proxy === 'function' ? new Proxy(proxyTarget, proxyHandler) : Object.create(null);

  system.set(fallbackHref, fallbackModule);

  return fallbackHref;
}

export function isESModule(code: string) {
  return IMPORT_EXPORT_RX.test(code);
}

export function log(...args: Parameters<WindowConsole['console']['log']>) {
  if ((window as any).VELCRO_DEBUG) {
    console.log(...args);
  }
}

export class Deferred<T> {
  public readonly promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (err: Error) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}
