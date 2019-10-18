import { Bundler } from '@velcro/bundler';
import { Resolver, AbstractResolverHost, ResolverHost } from '@velcro/resolver';
import { openDB } from 'idb';

export class ResolverHostWithCache extends AbstractResolverHost {
  private readonly idbPromise = openDB('velcro', Bundler.schemaVersion, {
    async upgrade(db, oldVersion, newVersion, transaction) {
      console.log('Upgrading cache from version %s to %s', oldVersion, newVersion);

      if (!oldVersion) {
        db.createObjectStore('getCanonicalUrl');
        db.createObjectStore('getResolveRoot');
        db.createObjectStore('listEntries');
        db.createObjectStore('readFileContent');
      }

      await transaction.objectStore('getCanonicalUrl').clear();
      await transaction.objectStore('getResolveRoot').clear();
      await transaction.objectStore('listEntries').clear();
      await transaction.objectStore('readFileContent').clear();
    },
  }).catch(err => {
    console.error(err, 'error opening IndexedDB');

    return null;
  });

  private readonly inflightGetCanonicalUrl = new Map<string, ReturnType<ResolverHost['getCanonicalUrl']>>();
  private readonly inflightGetResolveRoot = new Map<string, ReturnType<ResolverHost['getResolveRoot']>>();
  private readonly inflightListEntries = new Map<string, ReturnType<ResolverHost['listEntries']>>();
  private readonly inflightReadFileContent = new Map<string, ReturnType<ResolverHost['readFileContent']>>();

  constructor(readonly host: ResolverHost) {
    super();
  }

  private async withCache<T, C = unknown>(
    href: string,
    loadFn: () => Promise<T>,
    inflightMap: Map<string, Promise<T>>,
    storeName: string,
    serialize?: (result: T) => C,
    deserialize?: (cached: C) => T
  ): Promise<T> {
    let idb = undefined;

    try {
      idb = await withTimeout(1000, this.idbPromise, `this.idbPromise`);
    } catch (err) {
      // Error already logged
    }

    if (idb) {
      try {
        const cached = await withTimeout(1000, idb.get(storeName, href), `idb.get(${storeName}, ${href})`);

        if (cached) {
          return deserialize ? deserialize(cached) : cached;
        }
      } catch (err) {
        console.error(err, 'error reading from cache');
      }
    }

    let inflight = inflightMap.get(href);

    if (!inflight) {
      inflight = loadFn();
      inflightMap.set(href, inflight);

      // Make sure we don't get an uncaught rejection
      inflight.catch(err => undefined);

      (async () => {
        try {
          const result = await withTimeout(1000, inflight, `await inflight(${href})`);

          if (idb) {
            try {
              await withTimeout(
                1000,
                idb.put(storeName, serialize ? serialize(result) : result, href),
                `idb.put(${storeName}, ${href})`
              );
            } catch (err) {
              console.error(err, 'error writing to cache');
            }
          }
        } finally {
          inflightMap.delete(href);
        }
      })();
    }

    return inflight;
  }

  async getCanonicalUrl(resolver: Resolver, url: URL) {
    const result = await this.withCache(
      url.href,
      () => this.host.getCanonicalUrl(resolver, url),
      this.inflightGetCanonicalUrl,
      'getCanonicalUrl',
      url => url.href,
      href => new URL(href)
    );

    return result;
  }

  async getResolveRoot(resolver: Resolver, url: URL) {
    const result = await this.withCache(
      url.href,
      () => this.host.getResolveRoot(resolver, url),
      this.inflightGetResolveRoot,
      'getResolveRoot',
      url => url.href,
      href => new URL(href)
    );

    return result;
  }

  async listEntries(resolver: Resolver, url: URL) {
    const result = await this.withCache(
      url.href,
      () => this.host.listEntries(resolver, url),
      this.inflightListEntries,
      'listEntries',
      entries =>
        entries.map(entry => ({
          type: entry.type,
          href: entry.url.href,
        })),
      cached =>
        cached.map(entry => ({
          type: entry.type,
          url: new URL(entry.href),
        }))
    );

    return result;
  }

  async readFileContent(resolver: Resolver, url: URL) {
    const result = await this.withCache(
      url.href,
      () => this.host.readFileContent(resolver, url),
      this.inflightReadFileContent,
      'readFileContent'
    );

    return result;
  }
}

async function withTimeout<T>(duration: number, promise: Promise<T>, message: string) {
  const timeout = setTimeout(() => {
    console.warn(`Timed out after ${duration}ms on: ${message}`);
  }, duration);

  try {
    return await promise;
  } finally {
    clearTimeout(timeout);
  }
}
