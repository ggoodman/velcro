import { satisfies, validRange } from 'semver';
import { Thenable, CancellationToken, basename } from 'ts-primitives';

import { ResolverContext } from './context';
import { AbstractResolverStrategy } from './resolver';
import {
  ResolvedEntryKind,
  ResolverStrategy,
  CanonicalizeResult,
  ResolveRootResult,
  ListEntriesResult,
  BareModuleResult,
} from './strategy';
import { Uri } from './uri';
import { PackageJson, parseBufferAsPackageJson } from './packageJson';
import { checkCancellation, all, isThenable } from './async';
import { EntryNotFoundError } from './error';

interface AbstractCdn {
  name: string;

  isValidUrl(url: Uri): boolean;
  normalizePackageListing(result: unknown): Directory;
  parseUrl(url: Uri | string): Spec;
  urlForPackageFile(spec: string, pathname: string): Uri;
  urlForPackageList(spec: string): Uri;
}

export type Spec = {
  spec: string;
  name: string;
  version: string;
  pathname: string;
};

export type Directory = {
  type: ResolvedEntryKind.Directory;
  path: string;
  files?: ReadonlyArray<Entry>;
};
export type File = {
  type: ResolvedEntryKind.File;
  path: string;
};
export type Entry = Directory | File;

export type UrlContentFetcher = (
  href: string,
  token: CancellationToken
) => Thenable<ArrayBuffer | null>;

export function isValidEntry(entry: unknown): entry is Entry {
  if (!entry || typeof entry !== 'object') return false;

  return isValidFile(entry) || isValidDirectory(entry);
}

export function isValidDirectory(entry: unknown): entry is Directory {
  return (
    typeof entry === 'object' &&
    entry &&
    (entry as any).type === ResolvedEntryKind.Directory &&
    typeof (entry as any).path === 'string' &&
    (entry as any).path &&
    (typeof (entry as any).files === 'undefined' ||
      (Array.isArray((entry as any).files) && (entry as any).files.every(isValidEntry)))
  );
}

export function isValidFile(entry: unknown): entry is File {
  return (
    typeof entry === 'object' &&
    entry &&
    (entry as any).type === ResolvedEntryKind.File &&
    typeof (entry as any).path === 'string' &&
    (entry as any).path
  );
}

function specToString(spec: Spec) {
  return `${spec.spec}${spec.pathname}`;
}

class JSDelivrCdn implements AbstractCdn {
  name = 'jsdelivr';

  private readonly specRx = /^\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

  isValidUrl(url: Uri) {
    return url.scheme === JSDelivrCdn.protocol || url.authority === JSDelivrCdn.host;
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
          files: files.map((file) => mapChildEntry(path, file)),
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
      files: files.map((file) => mapChildEntry('', file)),
    };
  }

  parseUrl(url: Uri | string) {
    if (Uri.isUri(url)) {
      url = url.path;
    }

    const prefix = `/npm`;

    if (!url.startsWith(prefix)) {
      throw new Error(`Unable to parse unexpected ${this.name} url: ${url}`);
    }

    url = url.slice(prefix.length);

    /**
     * 1: scope + name + version
     * 2: scope + name
     * 3: version?
     * 4: pathname
     */
    const matches = url.match(this.specRx);

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

  urlForPackageFile(spec: string, pathname: string): Uri {
    return Uri.from({
      scheme: JSDelivrCdn.protocol,
      authority: JSDelivrCdn.host,
      path: `/npm/${spec}${pathname}`,
    });
  }

  urlForPackageList(spec: string): Uri {
    return Uri.from({
      scheme: JSDelivrCdn.protocol,
      authority: JSDelivrCdn.dataHost,
      path: `/v1/package/npm/${spec}/tree`,
    });
  }

  static readonly protocol = 'https';
  static readonly host = 'cdn.jsdelivr.net';
  static readonly dataHost = 'data.jsdelivr.com';
}

class UnpkgCdn implements AbstractCdn {
  name = 'unpkg';

  private readonly UNPKG_SPEC_RX = /^\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

  isValidUrl(url: Uri) {
    return url.scheme === UnpkgCdn.protocol || url.authority === UnpkgCdn.host;
  }

  normalizePackageListing(result: unknown) {
    if (!isValidDirectory(result)) {
      throw new Error(`Error normalizing directory listing`);
    }

    return result;
  }

  parseUrl(url: Uri | string) {
    if (Uri.isUri(url)) {
      url = url.path;
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

  urlForPackageFile(spec: string, pathname: string): Uri {
    return Uri.from({
      scheme: UnpkgCdn.protocol,
      authority: UnpkgCdn.host,
      path: `/${spec}${pathname}`,
    });
  }

  urlForPackageList(spec: string) {
    return Uri.from({
      scheme: UnpkgCdn.protocol,
      authority: UnpkgCdn.host,
      path: `/${spec}/`,
      query: 'meta',
    });
  }

  static readonly protocol = 'https';
  static readonly host = 'unpkg.com';
}

export class CdnStrategy extends AbstractResolverStrategy implements ResolverStrategy {
  readonly #cdn: AbstractCdn;
  readonly #contentCache = new Map<
    string,
    null | { content: ArrayBuffer } | Thenable<{ content: ArrayBuffer }>
  >();
  readonly #locks = new Map<string, unknown | Thenable<unknown>>();
  readonly #packageEntriesCache = new Map<string, Map<string, Directory>>();
  readonly #packageJsonCache = new Map<string, Map<string, PackageJson>>();
  readonly #readUrlFn: UrlContentFetcher;

  constructor(readUrlFn: UrlContentFetcher, cdn: 'jsdelivr' | 'unpkg' = 'jsdelivr') {
    super();

    this.#cdn = cdn === 'jsdelivr' ? new JSDelivrCdn() : new UnpkgCdn();
    this.#readUrlFn = readUrlFn;
  }

  private _withRootUriCheck<T extends unknown | Thenable<unknown>>(
    uri: Uri,
    fn: (rootUri: Uri) => T
  ): T {
    const { uri: rootUri } = this.getRootUrl();

    if (!Uri.isPrefixOf(rootUri, uri)) {
      throw new Error(
        `This strategy is only able to handle URIs under '${rootUri.toString(
          true
        )}' and is unable to handle '${uri.toString()}'`
      );
    }

    return fn(rootUri);
  }

  async getUrlForBareModule(spec: string, ctx: ResolverContext): Promise<BareModuleResult> {
    const unresolvedUri = this.#cdn.urlForPackageFile(spec, '');
    const resolveReturn = await ctx.resolve(unresolvedUri);

    return resolveReturn;
  }

  getCanonicalUrl(uri: Uri, ctx: ResolverContext): Promise<CanonicalizeResult> {
    return this._withRootUriCheck(uri, async () => {
      const unresolvedSpec = this.#cdn.parseUrl(uri);
      const packageJsonReturn = this._readPackageJsonWithCache(unresolvedSpec, ctx);
      const packageJson = isThenable(packageJsonReturn)
        ? await packageJsonReturn
        : packageJsonReturn;

      return {
        uri: this.#cdn.urlForPackageFile(
          `${packageJson.name}@${packageJson.version}`,
          unresolvedSpec.pathname
        ),
      };
    });
    // const results = all([ctx.getRootUrl(uri), ctx.getResolveRoot(uri)], ctx.token);
    // const [rootUriResult, resolveRootResult] = isThenable(results) ? await results : results;
  }

  getResolveRoot(uri: Uri, ctx: ResolverContext): Promise<ResolveRootResult> {
    return this._withRootUriCheck(uri, async () => {
      const unresolvedSpec = this.#cdn.parseUrl(uri);
      const packageJsonReturn = this._readPackageJsonWithCache(unresolvedSpec, ctx);
      const packageJson = isThenable(packageJsonReturn)
        ? await packageJsonReturn
        : packageJsonReturn;

      return {
        uri: this.#cdn.urlForPackageFile(`${packageJson.name}@${packageJson.version}`, '/'),
      };
    });
  }

  getRootUrl() {
    return {
      uri: this.#cdn.urlForPackageFile('', ''),
    };
  }

  listEntries(uri: Uri, ctx: ResolverContext): Promise<ListEntriesResult> {
    return this._withRootUriCheck(
      uri,
      async (): Promise<ListEntriesResult> => {
        const unresolvedSpec = this.#cdn.parseUrl(uri);
        const results = all(
          [
            ctx.getResolveRoot(uri),
            this._readPackageJsonWithCache(unresolvedSpec, ctx),
            this._readPackageEntriesWithCache(unresolvedSpec, ctx),
          ],
          ctx.token
        );

        const [{ uri: resolveRootUri }, packageJson, entriesReturn] = isThenable(results)
          ? await results
          : results;
        const canonicalizedSpec: Spec = {
          name: packageJson.name,
          pathname: unresolvedSpec.pathname,
          spec: `${packageJson.name}@${packageJson.version}`,
          version: packageJson.version,
        };

        // Proactively cache the canonicalized package entries
        this.#packageEntriesCache.get(packageJson.name)!.set(packageJson.version, entriesReturn);

        const traversalSegments = canonicalizedSpec.pathname.split('/').filter(Boolean);

        let parentEntry: Directory | undefined = entriesReturn;

        while (parentEntry && traversalSegments.length) {
          const segment = traversalSegments.shift() as string;

          if (parentEntry.type !== ResolvedEntryKind.Directory || !parentEntry.files) {
            throw new EntryNotFoundError(ctx.uri);
          }

          parentEntry = parentEntry.files.find(
            (file) => file.type === ResolvedEntryKind.Directory && basename(file.path) === segment
          ) as Directory | undefined;
        }

        if (!parentEntry) {
          throw new EntryNotFoundError(ctx.uri);
        }

        if (!parentEntry.files) {
          return {
            entries: [],
          };
        }

        return {
          entries: parentEntry.files.map((entry) => {
            return {
              type: entry.type,
              uri: Uri.joinPath(resolveRootUri, `.${entry.path}`),
            };
          }),
        };
      }
    );
  }

  readFileContent(uri: Uri, ctx: ResolverContext) {
    return this._withRootUriCheck(uri, () => {
      const uriStr = uri.toString();
      const cached = this.#contentCache.get(uriStr);

      if (cached === null) {
        return Promise.reject(new EntryNotFoundError(ctx.uri));
      }

      if (cached) {
        return cached;
      }

      const readReturn = this.#readUrlFn(uriStr, ctx.token);

      if (readReturn === null) {
        this.#contentCache.set(uriStr, null);

        return Promise.reject(new EntryNotFoundError(ctx.uri));
      }

      if (isThenable(readReturn)) {
        const wrappedReturn = readReturn.then((data) => {
          if (data === null) {
            this.#contentCache.delete(uriStr);

            return Promise.reject(new EntryNotFoundError(ctx.uri));
          }

          const entry = { content: data };

          this.#contentCache.set(uriStr, entry);

          return entry;
        });

        this.#contentCache.set(uriStr, wrappedReturn);

        return wrappedReturn;
      }

      const entry = { content: readReturn };
      this.#contentCache.set(uriStr, entry);

      return entry;
    });
  }

  private _readPackageEntriesWithCache(spec: Spec, ctx: ResolverContext) {
    ctx.debug('_readPackageEntriesWithCache(%s)', specToString(spec));

    return this._withLock(`packageEntries:${spec.name}`, () => {
      let packageEntriesCacheForModule = this.#packageEntriesCache.get(spec.name);

      if (packageEntriesCacheForModule) {
        const exactMatch = packageEntriesCacheForModule.get(spec.version);

        if (exactMatch) {
          // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
          return exactMatch;
        }

        const range = validRange(spec.version);

        if (range) {
          for (const [version, packageJson] of packageEntriesCacheForModule) {
            if (satisfies(version, range)) {
              // console.log('[HIT] readPackageJsonWithCache(%s)', spec.spec);
              return packageJson;
            }
          }
        }
      } else {
        packageEntriesCacheForModule = new Map();
        this.#packageEntriesCache.set(spec.name, packageEntriesCacheForModule);
      }

      return this._readPackageEntries(spec, ctx).then((rootDir) => {
        packageEntriesCacheForModule!.set(spec.version, rootDir);

        return rootDir;
      });
    });
  }

  private async _readPackageEntries(spec: Spec, ctx: ResolverContext) {
    ctx.debug('_readPackageEntries(%s)', specToString(spec));

    const uri = this.#cdn.urlForPackageList(spec.spec);
    const href = uri.toString();
    const data = await checkCancellation(this.#readUrlFn(href, ctx.token), ctx.token);

    if (data === null) {
      throw new EntryNotFoundError(ctx.uri);
    }

    const dataStr = ctx.decoder.decode(data);

    return this.#cdn.normalizePackageListing(JSON.parse(dataStr));
  }

  private _readPackageJsonWithCache(spec: Spec, ctx: ResolverContext) {
    ctx.debug('_readPackageJsonWithCache(%s)', specToString(spec));
    return this._withLock(`packageJson:${spec.name}`, () => {
      let packageJsonCacheForModule = this.#packageJsonCache.get(spec.name);

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
        this.#packageJsonCache.set(spec.name, packageJsonCacheForModule);
      }

      return this._readPackageJson(spec, ctx).then((packageJson) => {
        packageJsonCacheForModule!.set(packageJson.version, packageJson);

        return packageJson;
      });
    });
  }

  private async _readPackageJson(spec: Spec, ctx: ResolverContext): Promise<PackageJson> {
    ctx.debug('_readPackageJson(%s)', specToString(spec));
    const uri = this.#cdn.urlForPackageFile(spec.spec, '/package.json');
    const contentReturn = ctx.readFileContent(uri);
    const contentResult = isThenable(contentReturn) ? await contentReturn : contentReturn;

    let manifest: PackageJson;

    try {
      manifest = parseBufferAsPackageJson(ctx.decoder, contentResult.content, spec.spec);
    } catch (err) {
      throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
    }

    // Since we know what the canonicalized version is now (we didn't until the promise resolved)
    // and the package.json was parsed), we can proactively seed the content cache for the
    // canonical url.
    const canonicalHref = this.#cdn
      .urlForPackageFile(`${manifest.name}@${manifest.version}`, '/package.json')
      .toString();

    this.#contentCache.set(canonicalHref, contentResult);

    return manifest;
  }

  private _withLock<T extends unknown | Promise<unknown>>(
    lockKey: string,
    fn: (...args: any[]) => T
  ): T {
    const lock = this.#locks.get(lockKey);
    const runCriticalSection = (): T => {
      const ret = fn();

      if (isThenable(ret)) {
        const locked = ret.then(
          (result) => {
            this.#locks.delete(lockKey);

            return result;
          },
          (err) => {
            this.#locks.delete(lockKey);

            return Promise.reject(err);
          }
        );

        this.#locks.set(lockKey, locked);

        return ret;
      }

      // No need to lock in non-promise
      return ret;
    };

    if (isThenable(lock)) {
      return lock.then(runCriticalSection) as T;
    }

    return runCriticalSection();
  }
}
