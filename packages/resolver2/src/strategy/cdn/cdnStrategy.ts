import { satisfies, validRange } from 'semver';
import { basename, CancellationToken, Thenable } from 'ts-primitives';
import { ResolverContext, Visit, VisitKind } from '../../context';
import { EntryNotFoundError } from '../../error';
import {
  AbstractResolverStrategyWithRoot,
  BareModuleResult,
  CanonicalizeResult,
  ListEntriesResult,
  ResolvedEntryKind,
  ResolveRootResult,
  ResolverStrategyWithRoot,
} from '../../strategy';
import { all, checkCancellation, isThenable } from '../../util/async';
import { PackageJson, parseBufferAsPackageJson } from '../../util/packageJson';
import { Uri } from '../../util/uri';

interface AbstractCdn {
  name: string;

  isValidUrl(url: Uri): boolean;
  normalizePackageListing(result: unknown): CdnStrategy.Directory;
  parseUrl(url: Uri | string): CdnStrategy.Spec;
  urlForPackageFile(spec: string, pathname: string): Uri;
  urlForPackageList(spec: string): Uri;
}

function isValidEntry(entry: unknown): entry is CdnStrategy.Entry {
  if (!entry || typeof entry !== 'object') return false;

  return isValidFile(entry) || isValidDirectory(entry);
}

function isValidDirectory(entry: unknown): entry is CdnStrategy.Directory {
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

function isValidFile(entry: unknown): entry is File {
  return (
    typeof entry === 'object' &&
    entry &&
    (entry as any).type === ResolvedEntryKind.File &&
    typeof (entry as any).path === 'string' &&
    (entry as any).path
  );
}

function specToString(spec: CdnStrategy.Spec) {
  return `${spec.spec}${spec.pathname}`;
}

class JSDelivrCdn implements AbstractCdn {
  name = 'jsdelivr';

  private readonly specRx = /^\/((@[^/]+\/[^/@]+|[^/@]+)(?:@([^/]+))?)(.*)?$/;

  isValidUrl(url: Uri) {
    return url.scheme === JSDelivrCdn.protocol || url.authority === JSDelivrCdn.host;
  }

  normalizePackageListing(result: unknown): CdnStrategy.Directory {
    if (!result || typeof result !== 'object') {
      throw new Error(`Unexpected package listing contents`);
    }

    const files = (result as any).files;

    if (!Array.isArray(files)) {
      throw new Error(`Unexpected package listing contents`);
    }

    const mapChildEntry = (parent: string, child: unknown): CdnStrategy.Entry => {
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

export namespace CdnStrategy {
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
}

export class CdnStrategy extends AbstractResolverStrategyWithRoot
  implements ResolverStrategyWithRoot {
  private readonly cdn: AbstractCdn;
  private readonly contentCache = new Map<
    string,
    null | { content: ArrayBuffer } | Thenable<{ content: ArrayBuffer }>
  >();
  private readonly locks = new Map<string, unknown | Thenable<unknown>>();
  private readonly packageEntriesCache = new Map<string, Map<string, CdnStrategy.Directory>>();
  private readonly packageJsonCache = new Map<
    string,
    Map<string, { packageJson: PackageJson; visited: Visit[] }>
  >();
  private readonly readUrlFn: CdnStrategy.UrlContentFetcher;

  private constructor(readUrlFn: CdnStrategy.UrlContentFetcher, cdn: AbstractCdn) {
    super(cdn.urlForPackageFile('', ''));

    this.cdn = cdn;
    this.readUrlFn = readUrlFn;
  }

  private _withRootUriCheck<T extends unknown | Thenable<unknown>>(
    uri: Uri,
    fn: (rootUri: Uri) => T
  ): T {
    if (!Uri.isPrefixOf(this.rootUri, uri)) {
      throw new Error(
        `This strategy is only able to handle URIs under '${this.rootUri.toString()}' and is unable to handle '${uri.toString()}'`
      );
    }

    return fn(this.rootUri);
  }

  async getUrlForBareModule(
    ctx: ResolverContext,
    name: string,
    spec: string,
    path: string
  ): Promise<BareModuleResult> {
    const unresolvedUri = this.cdn.urlForPackageFile(`${name}@${spec}`, path);
    const resolveReturn = await ctx.resolve(unresolvedUri);

    return resolveReturn;
  }

  getCanonicalUrl(ctx: ResolverContext, uri: Uri): Promise<CanonicalizeResult> {
    return this._withRootUriCheck(uri, async () => {
      const unresolvedSpec = this.cdn.parseUrl(uri);
      const packageJsonReturn = ctx.runInChildContext(
        'CdnStrategy._readPackageJsonWithCache',
        specToString(unresolvedSpec),
        (ctx) => this._readPackageJsonWithCache(ctx, unresolvedSpec)
      );
      const packageJson = isThenable(packageJsonReturn)
        ? await packageJsonReturn
        : packageJsonReturn;

      return {
        uri: this.cdn.urlForPackageFile(
          `${packageJson.name}@${packageJson.version}`,
          unresolvedSpec.pathname
        ),
      };
    });
    // const results = all([ctx.getRootUrl(uri), ctx.getResolveRoot(uri)], ctx.token);
    // const [rootUriResult, resolveRootResult] = isThenable(results) ? await results : results;
  }

  getResolveRoot(ctx: ResolverContext, uri: Uri): Promise<ResolveRootResult> {
    return this._withRootUriCheck(uri, async () => {
      const unresolvedSpec = this.cdn.parseUrl(uri);
      const packageJsonReturn = this._readPackageJsonWithCache(ctx, unresolvedSpec);
      const packageJson = isThenable(packageJsonReturn)
        ? await packageJsonReturn
        : packageJsonReturn;

      return {
        uri: this.cdn.urlForPackageFile(`${packageJson.name}@${packageJson.version}`, '/'),
      };
    });
  }

  getRootUrl() {
    return {
      uri: this.cdn.urlForPackageFile('', ''),
    };
  }

  listEntries(ctx: ResolverContext, uri: Uri): Promise<ListEntriesResult> {
    return this._withRootUriCheck(
      uri,
      async (): Promise<ListEntriesResult> => {
        const unresolvedSpec = this.cdn.parseUrl(uri);
        const results = all(
          [
            ctx.getResolveRoot(uri),
            this._readPackageJsonWithCache(ctx, unresolvedSpec),
            this._readPackageEntriesWithCache(ctx, unresolvedSpec),
          ],
          ctx.token
        );

        const [{ uri: resolveRootUri }, packageJson, entriesReturn] = isThenable(results)
          ? await results
          : results;
        const canonicalizedSpec: CdnStrategy.Spec = {
          name: packageJson.name,
          pathname: unresolvedSpec.pathname,
          spec: `${packageJson.name}@${packageJson.version}`,
          version: packageJson.version,
        };

        // Proactively cache the canonicalized package entries
        this.packageEntriesCache.get(packageJson.name)!.set(packageJson.version, entriesReturn);

        const traversalSegments = canonicalizedSpec.pathname.split('/').filter(Boolean);

        let parentEntry: CdnStrategy.Directory | undefined = entriesReturn;

        while (parentEntry && traversalSegments.length) {
          const segment = traversalSegments.shift() as string;

          if (parentEntry.type !== ResolvedEntryKind.Directory || !parentEntry.files) {
            throw new EntryNotFoundError(uri);
          }

          parentEntry = parentEntry.files.find(
            (file) => file.type === ResolvedEntryKind.Directory && basename(file.path) === segment
          ) as CdnStrategy.Directory | undefined;
        }

        if (!parentEntry) {
          throw new EntryNotFoundError(uri);
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

  readFileContent(ctx: ResolverContext, uri: Uri) {
    return this._withRootUriCheck(uri, () => {
      const uriStr = uri.toString();
      const cached = this.contentCache.get(uriStr);

      if (cached === null) {
        return Promise.reject(new EntryNotFoundError(uri));
      }

      if (cached) {
        return cached;
      }

      ctx.recordVisit(uri, VisitKind.File);
      const readReturn = this.readUrlFn(uriStr, ctx.token);

      if (readReturn === null) {
        this.contentCache.set(uriStr, null);

        return Promise.reject(new EntryNotFoundError(uri));
      }

      if (isThenable(readReturn)) {
        const wrappedReturn = readReturn.then((data) => {
          if (data === null) {
            this.contentCache.delete(uriStr);

            return Promise.reject(new EntryNotFoundError(uri));
          }

          const entry = { content: data };

          this.contentCache.set(uriStr, entry);

          return entry;
        });

        this.contentCache.set(uriStr, wrappedReturn);

        return wrappedReturn;
      }

      const entry = { content: readReturn };
      this.contentCache.set(uriStr, entry);

      return entry;
    });
  }

  private _readPackageEntriesWithCache(ctx: ResolverContext, spec: CdnStrategy.Spec) {
    ctx.debug('%s._readPackageEntriesWithCache(%s)', this.constructor.name, specToString(spec));

    return this._withLock(`packageEntries:${spec.name}`, () => {
      let packageEntriesCacheForModule = this.packageEntriesCache.get(spec.name);

      if (packageEntriesCacheForModule) {
        const exactMatch = packageEntriesCacheForModule.get(spec.version);

        if (exactMatch) {
          // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
          return exactMatch;
        }

        const range = validRange(spec.version);

        if (range) {
          for (const [version, entries] of packageEntriesCacheForModule) {
            if (satisfies(version, range)) {
              return entries;
            }
          }
        }
      } else {
        packageEntriesCacheForModule = new Map();
        this.packageEntriesCache.set(spec.name, packageEntriesCacheForModule);
      }

      return this._readPackageEntries(ctx, spec).then((rootDir) => {
        packageEntriesCacheForModule!.set(spec.version, rootDir);

        return rootDir;
      });
    });
  }

  private async _readPackageEntries(ctx: ResolverContext, spec: CdnStrategy.Spec) {
    ctx.debug('%s._readPackageEntries(%s)', this.constructor.name, specToString(spec));

    const uri = this.cdn.urlForPackageList(spec.spec);
    const href = uri.toString();
    ctx.recordVisit(uri, VisitKind.Directory);
    const data = await checkCancellation(this.readUrlFn(href, ctx.token), ctx.token);

    if (data === null) {
      throw new EntryNotFoundError(spec);
    }

    const dataStr = ctx.decoder.decode(data);

    return this.cdn.normalizePackageListing(JSON.parse(dataStr));
  }

  private _readPackageJsonWithCache(ctx: ResolverContext, spec: CdnStrategy.Spec) {
    return this._withLock(`packageJson:${spec.name}`, () => {
      let packageJsonCacheForModule = this.packageJsonCache.get(spec.name);

      if (packageJsonCacheForModule) {
        const exactMatch = packageJsonCacheForModule.get(spec.version);

        if (exactMatch) {
          // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
          for (const visit of exactMatch.visited) {
            ctx.recordVisit(visit.uri, visit.type);
          }
          return exactMatch.packageJson;
        }

        const range = validRange(spec.version);

        if (range) {
          for (const [version, entry] of packageJsonCacheForModule) {
            if (satisfies(version, range)) {
              // console.log('[HIT] readPackageJsonWithCache(%s)', spec.spec);
              for (const visit of entry.visited) {
                ctx.recordVisit(visit.uri, visit.type);
              }
              return entry.packageJson;
            }
          }
        }
      } else {
        packageJsonCacheForModule = new Map();
        this.packageJsonCache.set(spec.name, packageJsonCacheForModule);
      }

      return this._readPackageJson(spec, ctx).then((packageJson) => {
        packageJsonCacheForModule!.set(packageJson.version, { packageJson, visited: ctx.visited });

        return packageJson;
      });
    });
  }

  private async _readPackageJson(
    spec: CdnStrategy.Spec,
    ctx: ResolverContext
  ): Promise<PackageJson> {
    ctx.debug('%s._readPackageJson(%s)', this.constructor.name, specToString(spec));
    const uri = this.cdn.urlForPackageFile(spec.spec, '/package.json');
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
    const canonicalHref = this.cdn
      .urlForPackageFile(`${manifest.name}@${manifest.version}`, '/package.json')
      .toString();

    this.contentCache.set(canonicalHref, contentResult);

    return manifest;
  }

  private _withLock<T extends unknown | Promise<unknown>>(
    lockKey: string,
    fn: (...args: any[]) => T
  ): T {
    const lock = this.locks.get(lockKey);
    const runCriticalSection = (): T => {
      const ret = fn();

      if (isThenable(ret)) {
        const locked = ret.then(
          (result) => {
            this.locks.delete(lockKey);

            return result;
          },
          (err) => {
            this.locks.delete(lockKey);

            return Promise.reject(err);
          }
        );

        this.locks.set(lockKey, locked);

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

  static forJsDelivr(readUrlFn: CdnStrategy.UrlContentFetcher) {
    return new CdnStrategy(readUrlFn, new JSDelivrCdn());
  }

  static forUnpkg(readUrlFn: CdnStrategy.UrlContentFetcher) {
    return new CdnStrategy(readUrlFn, new UnpkgCdn());
  }
}
