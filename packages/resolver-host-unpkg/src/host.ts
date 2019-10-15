import {
  ResolvedEntry,
  ResolvedEntryKind,
  Resolver,
  util,
  PackageJson,
  ResolverHost,
  CancellationToken,
  CanceledError,
} from '@velcro/resolver';
import LRU from 'lru-cache';
import { satisfies, validRange } from 'semver';

import { EntryNotFoundError } from './error';
import { BareModuleSpec, Directory, Spec, CustomFetch, isValidDirectory } from './types';
import { parseUnpkgUrl, signalFromCancellationToken } from './util';

const UNPKG_PROTOCOL = 'https:';
const UNPKG_HOST = 'unpkg.com';

interface UnpkgPackageHostOptions {
  AbortController?: typeof AbortController;
  fetch?: CustomFetch;
}

export class ResolverHostUnpkg extends ResolverHost {
  private readonly AbortController?: typeof AbortController;
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
  }

  async getCanonicalUrl(resolver: Resolver, url: URL, { token }: { token?: CancellationToken } = {}) {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    return new URL(
      `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${packageJson.name}@${packageJson.version}${unresolvedSpec.pathname}`
    );
  }

  async getResolveRoot(resolver: Resolver, url: URL, { token }: { token?: CancellationToken } = {}): Promise<URL> {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${packageJson.name}@${packageJson.version}/`);
  }

  async listEntries(
    resolver: Resolver,
    url: URL,
    { token }: { token?: CancellationToken } = {}
  ): Promise<ResolvedEntry[]> {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const rootUrl = await resolver.host.getResolveRoot(resolver, url, { token });
    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec, { token });

    url.pathname = `/${packageJson.name}@${packageJson.version}${unresolvedSpec.pathname}`;

    let parentEntry: Directory | undefined = await this.readPackageEntriesWithCache(parseUnpkgUrl(url), { token });

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
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to read file contents for non-unpkg entries for ${url.href}`);
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
      .then(res => {
        if (!res.ok) {
          throw new Error(`Error reading file content for ${href}: ${res.status}`);
        }

        return res.arrayBuffer();
      })
      .catch(err => {
        if (err.name === 'AbortError') {
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

    const href = `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec}/package.json`;
    const content = await this.readFileContent(resolver, new URL(href), { token });

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

    const href = `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec}/?meta`;
    const signal = signalFromCancellationToken(token, this.AbortController);
    const fetch = this.fetch;
    const res = await fetch(href, { signal }).catch(err => {
      if (err.name === 'AbortError') {
        throw new CanceledError('Canceled');
      }

      throw err;
    });

    if (!res.ok) {
      throw new Error(`Error listing package contents for ${spec}: ${res.status}`);
    }

    const json = await res.json();

    if (!isValidDirectory(json)) {
      throw new Error(`Unexpected response payload while listing package contents for ${spec}`);
    }

    return json;
  }

  static resolveBareModule(_: ResolverHost, spec: BareModuleSpec) {
    return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec.name}@${spec.spec}${spec.pathname}`);
  }
}
