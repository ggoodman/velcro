import {
  AbstractResolverHost,
  ResolvedEntry,
  ResolvedEntryKind,
  Resolver,
  util,
  PackageJson,
  CancellationToken,
  CanceledError,
} from '@velcro/resolver';
import LRU from 'lru-cache';
import { satisfies, validRange } from 'semver';

import { EntryNotFoundError, FetchError } from './error';
import { Directory, Spec, CustomFetch, isValidDirectory, Entry } from './types';
import { signalFromCancellationToken } from './util';

interface UnpkgPackageHostOptions {
  AbortController?: typeof AbortController;
  fetch?: CustomFetch;
  cdn?: 'unpkg' | 'jsdelivr';
}

interface AbstractCdn {
  name: string;

  isValidUrl(url: URL): boolean;
  normalizePackageListing(result: unknown): Directory;
  parseUrl(url: URL | string): Spec;
  urlForPackageFile(spec: string, pathname: string): URL;
  urlForPackageList(spec: string): URL;
}

class UnpkgCdn implements AbstractCdn {
  name = 'unpkg';

  private readonly UNPKG_SPEC_RX = /^\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

  isValidUrl(url: URL) {
    return url.protocol !== UnpkgCdn.protocol || url.hostname !== UnpkgCdn.host;
  }

  normalizePackageListing(result: unknown) {
    if (!isValidDirectory(result)) {
      throw new Error(`Error normalizing directory listing`);
    }

    return result;
  }

  parseUrl(url: URL | string) {
    if (url instanceof URL) {
      url = url.pathname;
    }

    /**
     * 1: scope + name + version
     * 2: scope + name
     * 3: version?
     * 4: pathname
     */
    const matches = url.match(this.UNPKG_SPEC_RX);

    if (!matches) {
      throw new Error(`Unable to parse unexpected unpkg url: ${url}`);
    }

    return {
      spec: matches[1],
      name: matches[2],
      version: matches[3] || '',
      pathname: matches[4] || '',
    };
  }

  urlForPackageFile(spec: string, pathname: string): URL {
    return new URL(`${UnpkgCdn.protocol}//${UnpkgCdn.host}/${spec}${pathname}`);
  }

  urlForPackageList(spec: string) {
    return new URL(`${UnpkgCdn.protocol}//${UnpkgCdn.host}/${spec}/?meta`);
  }

  static readonly protocol = 'https:';
  static readonly host = 'unpkg.com';
}

class JSDelivrCdn implements AbstractCdn {
  name = 'jsdelivr';

  private readonly JSDELIVR_SPEC_RX = /^\/npm\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

  isValidUrl(url: URL) {
    return url.protocol !== JSDelivrCdn.protocol || url.hostname !== JSDelivrCdn.host;
  }

  normalizePackageListing(result: unknown): Directory {
    if (!result || typeof result !== 'object') {
      throw new Error(`Unexpected package listing contents`);
    }

    const files = (result as any).files;

    if (!Array.isArray(files)) {
      throw new Error(`Unexpected package listing contents`);
    }

    const mapChildEntry = (parent: string, child: unknown): Entry => {
      if (!child || typeof child !== 'object') {
        throw new Error(`Unexpected entry in package listing contents`);
      }

      const name = (child as any).name;

      if (typeof name !== 'string') {
        throw new Error(`Unexpected entry in package listing contents`);
      }

      const path = `${parent}/${name}`;

      if ((child as any).type === ResolvedEntryKind.Directory) {
        const files = (child as any).files;

        if (!Array.isArray(files)) {
          throw new Error(`Unexpected entry in package listing contents`);
        }
        return {
          type: ResolvedEntryKind.Directory,
          path,
          files: files.map(file => mapChildEntry(path, file)),
        };
      } else if ((child as any).type === ResolvedEntryKind.File) {
        return {
          type: ResolvedEntryKind.File,
          path,
        };
      }

      throw new Error(`Error mapping child entry in package file listing`);
    };

    return {
      type: ResolvedEntryKind.Directory,
      path: '/',
      files: files.map(file => mapChildEntry('', file)),
    };
  }

  parseUrl(url: URL | string) {
    if (url instanceof URL) {
      url = url.pathname;
    }

    /**
     * 1: scope + name + version
     * 2: scope + name
     * 3: version?
     * 4: pathname
     */
    const matches = url.match(this.JSDELIVR_SPEC_RX);

    if (!matches) {
      throw new Error(`Unable to parse unexpected unpkg url: ${url}`);
    }

    return {
      spec: matches[1],
      name: matches[2],
      version: matches[3] || '',
      pathname: matches[4] || '',
    };
  }

  urlForPackageFile(spec: string, pathname: string): URL {
    return new URL(`${JSDelivrCdn.protocol}//${JSDelivrCdn.host}/npm/${spec}${pathname}`);
  }

  urlForPackageList(spec: string) {
    return new URL(`${JSDelivrCdn.protocol}//${JSDelivrCdn.dataHost}/v1/package/npm/${spec}/tree`);
  }

  static readonly protocol = 'https:';
  static readonly host = 'cdn.jsdelivr.net';
  static readonly dataHost = 'data.jsdelivr.com';
}

export class ResolverHostUnpkg extends AbstractResolverHost {
  private readonly AbortController?: typeof AbortController;
  private readonly cdn: AbstractCdn;
  private readonly contentCache = new LRU<string, ArrayBuffer>({
    length(buf) {
      return buf.byteLength;
    },
    max: 1024 * 1024 * 5,
  });
  private readonly fetch: CustomFetch;
  private readonly inflightContentRequests = new Map<string, Promise<ArrayBuffer>>();
  private readonly packageLock = new Map<string, Promise<any>>();
  private readonly packageEntriesCache = new Map<string, Map<string, Directory>>();
  private readonly packageJsonCache = new Map<string, Map<string, PackageJson>>();

  constructor(options: UnpkgPackageHostOptions = {}) {
    super();

    if (!options.fetch && typeof fetch !== 'function') {
      throw new TypeError(
        `A fetch function must be provided to the ${this.constructor.name} if the environment doesn't provide one`
      );
    }

    this.AbortController = options.AbortController;
    this.fetch = options.fetch || ((input: RequestInfo, init?: RequestInit) => fetch(input, init));
    this.cdn = options.cdn === 'jsdelivr' ? new JSDelivrCdn() : new UnpkgCdn();
  }

  async getCanonicalUrl(resolver: Resolver, url: URL, { token }: { token?: CancellationToken } = {}) {
    if (this.cdn.isValidUrl(url)) {
      throw new Error(`Unable to list non-${this.cdn.name} entries for ${url.href}`);
    }

    const unresolvedSpec = this.cdn.parseUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    if (!packageJson.name) {
      throw new Error(`Missing name property in package.json for '${url.href}'`);
    }
    if (!packageJson.version) {
      throw new Error(`Missing version property in package.json for '${url.href}'`);
    }

    return this.cdn.urlForPackageFile(`${packageJson.name}@${packageJson.version}`, unresolvedSpec.pathname);
  }

  async getResolveRoot(resolver: Resolver, url: URL, { token }: { token?: CancellationToken } = {}): Promise<URL> {
    if (this.cdn.isValidUrl(url)) {
      throw new Error(`Unable to list non-${this.cdn.name} entries for ${url.href}`);
    }

    const unresolvedSpec = this.cdn.parseUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    if (!packageJson.name) {
      throw new Error(`Missing name property in package.json for '${url.href}'`);
    }
    if (!packageJson.version) {
      throw new Error(`Missing version property in package.json for '${url.href}'`);
    }

    return this.cdn.urlForPackageFile(`${packageJson.name}@${packageJson.version}`, '/');
  }

  getRoot() {
    return this.cdn.urlForPackageFile('', '');
  }

  async listEntries(
    resolver: Resolver,
    url: URL,
    { token }: { token?: CancellationToken } = {}
  ): Promise<ResolvedEntry[]> {
    if (this.cdn.isValidUrl(url)) {
      throw new Error(`Unable to list non-${this.cdn.name} entries for ${url.href}`);
    }

    const rootUrl = await resolver.host.getResolveRoot(resolver, url, { token });
    const unresolvedSpec = this.cdn.parseUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    url = this.cdn.urlForPackageFile(`${packageJson.name}@${packageJson.version}`, unresolvedSpec.pathname);

    let parentEntry: Directory | undefined = await this.readPackageEntriesWithCache(this.cdn.parseUrl(url), { token });

    if (token && token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const traversalSegments = unresolvedSpec.pathname.split('/').filter(Boolean);

    while (parentEntry && traversalSegments.length) {
      const segment = traversalSegments.shift() as string;

      if (parentEntry.type !== ResolvedEntryKind.Directory || !parentEntry.files) {
        throw new EntryNotFoundError(url);
      }

      parentEntry = parentEntry.files.find(
        file => file.type === ResolvedEntryKind.Directory && Resolver.path.basename(file.path) === segment
      ) as Directory | undefined;
    }

    if (!parentEntry) {
      throw new EntryNotFoundError(url);
    }

    if (!parentEntry.files) {
      return [];
    }

    return parentEntry.files.map(entry => {
      return {
        type: entry.type,
        url: new URL(`.${entry.path}`, rootUrl),
      };
    });
  }

  async readFileContent(_: Resolver, url: URL, { token }: { token?: CancellationToken } = {}): Promise<ArrayBuffer> {
    if (this.cdn.isValidUrl(url)) {
      throw new Error(`Unable to read file contents for non-${this.cdn.name} entries for ${url.href}`);
    }

    const href = url.href;
    const cached = this.contentCache.get(href);

    if (cached) {
      // console.log('[HIT] readFileContent(%s)', href);
      return cached;
    }

    const inflight = this.inflightContentRequests.get(href);

    if (inflight) {
      // console.log('[AWAIT] readFileContent(%s)', href);
      return inflight;
    }

    // console.log('[MISS] readFileContent(%s)', href);
    const signal = signalFromCancellationToken(token, this.AbortController);
    const fetch = this.fetch;
    const promise = fetch(href, { redirect: 'follow', signal })
      .then(
        res => {
          if (!res.ok) {
            throw new Error(`Error reading file content for ${href}: ${res.status}`);
          }

          return res.arrayBuffer();
        },
        err => {
          throw new FetchError(href, err);
        }
      )
      .catch(err => {
        if (signal && signal.aborted) {
          throw new CanceledError('Canceled');
        }

        throw err;
      });

    this.inflightContentRequests.set(href, promise);

    try {
      const buf = await promise;

      this.contentCache.set(href, buf);

      return buf;
    } finally {
      this.inflightContentRequests.delete(href);
    }
  }

  resolveBareModule(spec: string, pathname = '') {
    return this.cdn.urlForPackageFile(spec, pathname);
  }

  private async readPackageEntriesWithCache(
    spec: Spec,
    { token }: { token?: CancellationToken } = {}
  ): Promise<Directory> {
    const lockKey = `entries:${spec.name}`;
    const lock = this.packageLock.get(lockKey);

    if (lock) {
      // console.log('[LOCK] readPackageEntriesWithCache.awaitLock(%s)', lockKey);
      await lock;
    }

    const range = validRange(spec.version);

    if (!range) {
      throw new Error(`Invalid SemVer range for spec ${spec.spec}`);
    }

    let packageEntriesCacheForModule = this.packageEntriesCache.get(spec.name);

    if (packageEntriesCacheForModule) {
      const exactMatch = packageEntriesCacheForModule.get(spec.version);

      if (exactMatch) {
        // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
        return exactMatch;
      }

      for (const [version, packageEntries] of packageEntriesCacheForModule) {
        if (satisfies(version, range)) {
          // console.log('[HIT] readPackageEntriesWithCache(%s)', spec.spec);
          return packageEntries;
        }
      }
    } else {
      packageEntriesCacheForModule = new Map();
      this.packageEntriesCache.set(spec.name, packageEntriesCacheForModule);
    }

    // console.log('[MISS] readPackageEntriesWithCache(%s)', spec.spec);
    const promise = this.readPackageEntries(spec.spec, { token });

    this.packageLock.set(lockKey, promise);
    const packageEntries = await promise;
    this.packageLock.delete(lockKey);

    packageEntriesCacheForModule.set(spec.version, packageEntries);

    return packageEntries;
  }

  private async readPackageJsonWithCache(
    resolver: Resolver,
    spec: Spec,
    { token }: { token?: CancellationToken } = {}
  ): Promise<PackageJson> {
    const lockKey = `packageJson:${spec.spec}`;
    const lock = this.packageLock.get(lockKey);

    if (lock) {
      // console.log('[LOCK] readPackageJsonWithCache.awaitLock(%s)', lockKey);
      await lock;
    }

    let packageJsonCacheForModule = this.packageJsonCache.get(spec.name);

    if (packageJsonCacheForModule) {
      const exactMatch = packageJsonCacheForModule.get(spec.version);

      if (exactMatch) {
        // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
        return exactMatch;
      }

      const range = validRange(spec.version);

      if (range) {
        for (const [version, packageJson] of packageJsonCacheForModule) {
          if (satisfies(version, range)) {
            // console.log('[HIT] readPackageJsonWithCache(%s)', spec.spec);
            return packageJson;
          }
        }
      }
    } else {
      packageJsonCacheForModule = new Map();
      this.packageJsonCache.set(spec.name, packageJsonCacheForModule);
    }

    // console.log('[MISS] readPackageJsonWithCache(%s)', spec.spec);
    const promise = this.readPackageJson(resolver, spec.spec, { token });

    this.packageLock.set(lockKey, promise);
    const packageJson = await promise;
    this.packageLock.delete(lockKey);

    if (!packageJson.version) {
      throw new Error(`Manifest missing a version identifier for ${spec}`);
    }

    packageJsonCacheForModule.set(packageJson.version, packageJson);

    return packageJson;
  }

  private async readPackageJson(
    resolver: Resolver,
    spec: string,
    { token }: { token?: CancellationToken } = {}
  ): Promise<PackageJson> {
    // console.log('readPackageJson(%s)', spec);

    const url = this.cdn.urlForPackageFile(spec, '/package.json');
    const content = await this.readFileContent(resolver, url, { token });

    let manifest: PackageJson;

    try {
      manifest = util.parseBufferAsPackageJson(resolver.decoder, content, spec);
    } catch (err) {
      throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
    }

    return manifest;
  }

  private async readPackageEntries(spec: string, { token }: { token?: CancellationToken } = {}): Promise<Directory> {
    // console.log('readPackageEntries(%s)', spec);

    const url = this.cdn.urlForPackageList(spec);
    const href = url.href;
    const signal = signalFromCancellationToken(token, this.AbortController);
    const fetch = this.fetch;
    const res = await fetch(href, { signal }).catch(err => {
      if (signal && signal.aborted) {
        throw new CanceledError('Canceled');
      }

      throw new FetchError(href, err);
    });

    if (!res.ok) {
      throw new Error(`Error listing package contents for ${spec}: ${res.status}`);
    }

    const json = await res.json();

    return this.cdn.normalizePackageListing(json);
  }
}
