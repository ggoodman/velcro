import { Resolver, AbstractResolverHost, ResolverHost, ResolverHostOperationOptions } from '@velcro/resolver';
import { timeout } from 'ts-primitives';
import { TimeoutError } from './error';

export class ResolverHostWithInflightCache extends AbstractResolverHost {
  private readonly hostTimeout: number;

  private readonly inflightGetCanonicalUrl = new Map<string, ReturnType<ResolverHost['getCanonicalUrl']>>();
  private readonly inflightGetResolveRoot = new Map<string, ReturnType<ResolverHost['getResolveRoot']>>();
  private readonly inflightListEntries = new Map<string, ReturnType<ResolverHost['listEntries']>>();
  private readonly inflightReadFileContent = new Map<string, ReturnType<ResolverHost['readFileContent']>>();

  constructor(readonly host: ResolverHost, { hostTimeout = 10000 } = {}) {
    super();

    this.hostTimeout = hostTimeout;
  }

  private withInflightGrouping<T, C = unknown>(
    href: string,
    loadFn: () => Promise<T>,
    inflightMap: Map<string, Promise<T>>,
    operationName: string
  ): Promise<T> {
    let inflight = inflightMap.get(href);

    if (!inflight) {
      inflight = withTimeout(
        this.hostTimeout,
        loadFn(),
        `Timed out while calling ${operationName}(${JSON.stringify(href)})`
      );

      inflightMap.set(href, inflight);
    }

    inflight.catch(_ => undefined).then(() => inflightMap.delete(href));

    return inflight;
  }

  async getCanonicalUrl(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions) {
    const result = await this.withInflightGrouping(
      url.href,
      () => this.host.getCanonicalUrl(resolver, url, options),
      this.inflightGetCanonicalUrl,
      'getCanonicalUrl'
    );

    return result;
  }

  async getResolveRoot(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions) {
    const result = await this.withInflightGrouping(
      url.href,
      () => this.host.getResolveRoot(resolver, url, options),
      this.inflightGetResolveRoot,
      'getResolveRoot'
    );

    return result;
  }

  async listEntries(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions) {
    const result = await this.withInflightGrouping(
      url.href,
      () => this.host.listEntries(resolver, url, options),
      this.inflightListEntries,
      'listEntries'
    );

    return result;
  }

  async readFileContent(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions) {
    try {
      const result = await this.withInflightGrouping(
        url.href,
        () => this.host.readFileContent(resolver, url, options),
        this.inflightReadFileContent,
        'readFileContent'
      );

      return result;
    } catch (err) {
      throw err;
    }
  }
}

function withTimeout<T>(duration: number, promise: Promise<T>, message: string) {
  return Promise.race([
    promise,
    timeout(duration * 10).then(() => {
      // console.debug('[ResolverHostWithCache] TIMEOUT(%d): %s', duration, message);
      return Promise.reject(new TimeoutError(message));
    }),
  ]);
}
