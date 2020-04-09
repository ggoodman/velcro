import { basename, CancellationToken, CancellationTokenSource } from 'ts-primitives';
import { all, isThenable, checkCancellation } from './async';
import { CanceledError, EntryNotFoundError } from './error';
import { Uri } from './uri';
import { parseBufferAsPackageJson, PackageJson } from './packageJson';
import { ResolverContext } from './context';
import { ResolverStrategy, ResolvedEntryKind, ResolvedEntry } from './strategy';
import { Settings } from './settings';

export interface ReadParentPackageJsonOptions {
  token?: CancellationToken;
}

interface ReadParentPackageJsonResultInternalFound {
  found: true;
  packageJson: PackageJson;
  uri: Uri;
}

interface ReadParentPackageJsonResultInternalNotFound {
  found: false;
  packageJson: null;
  uri: null;
}

type ReadParentPackageJsonResultInternal =
  | ReadParentPackageJsonResultInternalFound
  | ReadParentPackageJsonResultInternalNotFound;
export type ReadParentPackageJsonResult = ReadParentPackageJsonResultInternal & {
  visited: Set<string>;
};

export interface ResolveOptions {
  token?: CancellationToken;
}

interface ResolveResultInternal {
  found: boolean;
  uri: Uri | null;
}

export interface ResolveResult extends ResolveResultInternal {
  visited: Set<string>;
}

export abstract class AbstractResolverStrategy implements ResolverStrategy {
  getCanonicalUrl(
    uri: Uri,
    _ctx: ResolverContext
  ): ReturnType<ResolverStrategy['getCanonicalUrl']> {
    return {
      uri,
    };
  }

  abstract getRootUrl(uri: Uri, ctx: ResolverContext): ReturnType<ResolverStrategy['getRootUrl']>;

  getSettings(_uri: Uri, ctx: ResolverContext): ReturnType<ResolverStrategy['getSettings']> {
    return {
      settings: ctx.settings,
    };
  }

  abstract getResolveRoot(
    uri: Uri,
    ctx: ResolverContext
  ): ReturnType<ResolverStrategy['getResolveRoot']>;
  abstract listEntries(uri: Uri, ctx: ResolverContext): ReturnType<ResolverStrategy['listEntries']>;
  abstract readFileContent(
    uri: Uri,
    ctx: ResolverContext
  ): ReturnType<ResolverStrategy['readFileContent']>;
}

export class Resolver {
  readonly #settings: Settings;
  readonly #strategy: ResolverStrategy;

  constructor(strategy: ResolverStrategy, settings: Settings) {
    this.#settings = settings;
    this.#strategy = strategy;
  }

  resolve(url: string | Uri, options: ResolveOptions = {}): Promise<ResolveResult> {
    const tokenSource = new CancellationTokenSource(options.token);
    const ctx = ResolverContext.create(
      typeof url === 'string' ? Uri.parse(url) : url,
      this.#strategy,
      this.#settings,
      tokenSource.token
    );

    return this._resolve(url, ctx)
      .then(
        (result) => {
          return {
            ...result,
            visited: ctx.visited,
          };
        },
        (err) => {
          tokenSource.cancel();

          return Promise.reject(err);
        }
      )
      .finally(() => {
        tokenSource.dispose();
      });
  }

  readParentPackageJson(
    url: string | Uri,
    options: ReadParentPackageJsonOptions = {}
  ): Promise<ReadParentPackageJsonResult> {
    const tokenSource = new CancellationTokenSource(options.token);
    const ctx = ResolverContext.create(
      typeof url === 'string' ? Uri.parse(url) : url,
      this.#strategy,
      this.#settings,
      tokenSource.token
    );

    return this._readParentPackageJson(url, ctx)
      .then(
        (result) => {
          ctx.debug('readParentPackageJson result', result);
          return {
            ...result,
            visited: ctx.visited,
          };
        },
        (err) => {
          ctx.debug('readParentPackageJson error', err);
          tokenSource.cancel();

          return Promise.reject(err);
        }
      )
      .finally(() => {
        tokenSource.dispose();
      });
  }

  private async _resolve(url: string | Uri, ctx: ResolverContext): Promise<ResolveResultInternal> {
    ctx.debug('_resolve(%s)', url);
    const uri = Uri.isUri(url) ? url : Uri.parse(url);
    const bothResolved = all(
      [ctx.getCanonicalUrl(uri), ctx.getResolveRoot(uri), ctx.getSettings(uri)],
      ctx.token
    );

    const [canonicalizationResult, resolveRootResult, settingsResult] = isThenable(bothResolved)
      ? await checkCancellation(bothResolved, ctx.token)
      : bothResolved;

    const rootUri = resolveRootResult.uri;
    const rootUriWithoutTrailingSlash = Uri.ensureTrailingSlash(rootUri, '');

    if (!Uri.isPrefixOf(rootUriWithoutTrailingSlash, canonicalizationResult.uri)) {
      throw new Error(
        `Unable to resolve a module whose path ${canonicalizationResult.uri.toString()} is above the host's root ${rootUri.toString()}`
      );
    }

    if (
      Uri.equals(rootUriWithoutTrailingSlash, canonicalizationResult.uri) ||
      Uri.equals(rootUri, canonicalizationResult.uri)
    ) {
      return this._resolveAsDirectory(
        canonicalizationResult.uri,
        resolveRootResult.uri,
        settingsResult.settings,
        ctx
      );
    }

    return this._resolveAsFile(
      canonicalizationResult.uri,
      resolveRootResult.uri,
      settingsResult.settings,
      null,
      ctx
    );
  }

  private async _resolveAsDirectory(
    uri: Uri,
    rootUri: Uri,
    settings: Settings,
    ctx: ResolverContext
  ): Promise<ResolveResultInternal> {
    ctx.debug('_resolveAsDirectory(%s)', uri);
    ctx.visited.add(rootUri.toString());

    const listEntriesReturn = ctx.listEntries(uri);
    const listEntriesResult = isThenable(listEntriesReturn)
      ? await checkCancellation(listEntriesReturn, ctx.token)
      : listEntriesReturn;

    let mainPathname = 'index';

    // Step 1: Look for a package.json with an main field
    const packageJsonUri = Uri.joinPath(uri, './package.json');

    ctx.visited.add(packageJsonUri.toString());

    const packageJsonEntry = listEntriesResult.entries.find(
      (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(packageJsonUri, entry.uri)
    );

    let packageJson: PackageJson | null = null;

    if (packageJsonEntry) {
      const packageJsonContentReturn = ctx.readFileContent(packageJsonUri);
      const packageJsonContentResult = isThenable(packageJsonContentReturn)
        ? await checkCancellation(packageJsonContentReturn, ctx.token)
        : packageJsonContentReturn;

      packageJson = parseBufferAsPackageJson(
        ctx.decoder,
        packageJsonContentResult.content,
        uri.toString()
      );

      for (const packageMain of settings.packageMain) {
        const pathname = packageJson[packageMain];
        if (typeof pathname === 'string') {
          mainPathname = pathname;
          break;
        }
      }
    }

    return this._resolveAsFile(
      Uri.joinPath(uri, mainPathname),
      rootUri,
      settings,
      packageJson,
      ctx
    );
  }

  private async _resolveAsFile(
    uri: Uri,
    rootUri: Uri,
    settings: Settings,
    packageJson: PackageJson | null,
    ctx: ResolverContext,
    ignoreBrowserOverrides = false
  ): Promise<ResolveResultInternal> {
    ctx.debug('_resolveAsFile(%s)', uri);
    if (uri.path === '' || uri.path === '/') {
      throw new TypeError(`Unable to resolve the root as a file: ${uri.toString()}`);
    }

    ctx.visited.add(uri.toString());

    const browserOverrides = new Map<string, Uri | false>();

    if (packageJson === null) {
      // The parent package.json is only interesting if we are going to look at the `browser`
      // field and then consider browser mapping overrides in there.
      const parentPackageJsonResult =
        settings.packageMain.includes('browser') && !ignoreBrowserOverrides
          ? await checkCancellation(
              this._readParentPackageJsonInternal(uri, rootUri, ctx, {
                uriIsCanonicalized: true,
              }),
              ctx.token
            )
          : undefined;
      if (parentPackageJsonResult && parentPackageJsonResult.found) {
        ctx.visited.add(parentPackageJsonResult.uri.toString());

        if (
          parentPackageJsonResult.packageJson.browser &&
          typeof parentPackageJsonResult.packageJson.browser === 'object'
        ) {
          const browserMap = parentPackageJsonResult.packageJson.browser;
          const packageJsonDir = Uri.joinPath(parentPackageJsonResult.uri, '..');

          for (const entry in browserMap) {
            const impliedUri = Uri.joinPath(packageJsonDir, entry);
            const targetSpec = browserMap[entry];
            const target = targetSpec === false ? false : Uri.joinPath(packageJsonDir, targetSpec);

            if (Uri.equals(impliedUri, uri)) {
              if (target === false) {
                return {
                  found: false,
                  uri: null,
                };
              }

              // console.warn('REMAPPED %s to %s', url, target);

              // We found an exact match so let's make sure we resolve the re-mapped file but
              // also that we don't go through the browser overrides rodeo again.
              return this._resolveAsFile(target, rootUri, settings, packageJson, ctx, true);
            }

            browserOverrides.set(impliedUri.toString(), target);
          }
        }
      }
    }

    const containingDirUri = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));

    ctx.visited.add(containingDirUri.toString());

    const filename = basename(uri.path);
    const entriesReturn = ctx.listEntries(containingDirUri);
    const entriesResult = isThenable(entriesReturn)
      ? await checkCancellation(entriesReturn, ctx.token)
      : entriesReturn;
    const entryDirectoryMap = new Map<string, ResolvedEntry>();
    const entryFileMap = new Map<string, ResolvedEntry<ResolvedEntryKind.File>>();

    for (const entry of entriesResult.entries) {
      if (Uri.equals(entry.uri, uri) && entry.type == ResolvedEntryKind.File) {
        // Found an exact match
        return {
          found: true,
          uri,
        };
      }

      if (entry.type === ResolvedEntryKind.Directory) {
        const childFilename = Uri.getFirstPathSegmentAfterPrefix(entry.uri, containingDirUri);

        entryDirectoryMap.set(childFilename, entry);
      } else if (entry.type === ResolvedEntryKind.File) {
        const childFilename = basename(entry.uri.path);

        entryFileMap.set(childFilename, entry as ResolvedEntry<ResolvedEntryKind.File>);
      }
    }

    // Look for browser overrides
    for (const ext of settings.extensions) {
      const hrefWithExtension = uri.with({ path: `${uri.path}${ext}` }).toString();
      const mapping = browserOverrides.get(hrefWithExtension);

      ctx.visited.add(hrefWithExtension);

      if (mapping === false) {
        // console.warn('REMAPPED %s to undefined', url);
        return {
          found: true,
          uri: null,
        };
      } else if (mapping) {
        // console.warn('REMAPPED %s to %s', url, mapping);

        return this._resolveAsFile(mapping, rootUri, settings, packageJson, ctx, true);
      }

      const match = entryFileMap.get(`${filename}${ext}`);
      if (match) {
        if (match.type !== ResolvedEntryKind.File) {
          continue;
        }

        return {
          found: true,
          uri: match.uri,
        };
      }
    }

    // First, attempt to find a matching file or directory
    const match = entryDirectoryMap.get(filename);
    if (match) {
      if (match.type !== ResolvedEntryKind.Directory) {
        throw new Error(`Invariant violation ${match.type} is unexpected`);
      }

      return this._resolveAsDirectory(match.uri, rootUri, settings, ctx);
    }

    throw new EntryNotFoundError(uri);
  }

  private async _readParentPackageJson(
    url: string | Uri,
    ctx: ResolverContext
  ): Promise<ReadParentPackageJsonResultInternal> {
    ctx.debug('_readParentPackageJson(%s)', url);
    const uri = Uri.isUri(url) ? url : Uri.parse(url);
    const canonicalizationReturn = ctx.getCanonicalUrl(uri);
    const resolveRootReturn = ctx.getResolveRoot(uri);
    const bothResolved = all([canonicalizationReturn, resolveRootReturn], ctx.token);
    const [canonicalizationResult, resolveRootResult] = isThenable(bothResolved)
      ? await checkCancellation(bothResolved, ctx.token)
      : bothResolved;

    return this._readParentPackageJsonInternal(
      canonicalizationResult.uri,
      resolveRootResult.uri,
      ctx,
      { uriIsCanonicalized: true }
    );
  }

  private async _readParentPackageJsonInternal(
    uri: Uri,
    rootUri: Uri,
    ctx: ResolverContext,
    options: { uriIsCanonicalized: boolean }
  ): Promise<ReadParentPackageJsonResultInternal> {
    ctx.debug('_readParentPackageJsonInternal(%s)', uri);
    if (!options.uriIsCanonicalized) {
      const canonicalizationReturn = ctx.getCanonicalUrl(uri);
      const canonicalizationResult = isThenable(canonicalizationReturn)
        ? await checkCancellation(canonicalizationReturn, ctx.token)
        : canonicalizationReturn;

      uri = canonicalizationResult.uri;
    }

    const hostRootHref = Uri.ensureTrailingSlash(rootUri);
    const containingDirUrl = Uri.ensureTrailingSlash(Uri.joinPath(uri, '..'));

    const readPackageJsonOrRecurse = async (
      dir: Uri
    ): Promise<ReadParentPackageJsonResultInternal> => {
      ctx.debug('_readParentPackageJsonInternal::readPackageJsonOrRecurse(%s, %s)', uri, dir);
      if (!Uri.isPrefixOf(hostRootHref, dir)) {
        // Terminal condition for recursion
        return {
          found: false,
          packageJson: null,
          uri: null,
        };
      }

      ctx.visited.add(dir.toString());

      const entriesReturn = ctx.listEntries(dir);
      const entriesResult = isThenable(entriesReturn)
        ? await checkCancellation(entriesReturn, ctx.token)
        : entriesReturn;
      const packageJsonUri = Uri.joinPath(uri, '../package.json');
      const packageJsonEntry = entriesResult.entries.find(
        (entry) => entry.type === ResolvedEntryKind.File && Uri.equals(entry.uri, packageJsonUri)
      );

      ctx.visited.add(packageJsonUri.toString());

      if (packageJsonEntry) {
        // Found! Let's try to parse
        try {
          const parentPackageJsonContentReturn = ctx.readFileContent(packageJsonUri);
          const parentPackageJsonContentResult = isThenable(parentPackageJsonContentReturn)
            ? await checkCancellation(parentPackageJsonContentReturn, ctx.token)
            : parentPackageJsonContentReturn;

          const packageJson = parseBufferAsPackageJson(
            ctx.decoder,
            parentPackageJsonContentResult.content,
            packageJsonUri.toString()
          );

          return { found: true, packageJson, uri: packageJsonUri };
        } catch (err) {
          if (err instanceof CanceledError || (err && err.name === 'CanceledError')) {
            throw err;
          }

          // TODO: Maybe issue some warning?
        }
      }

      // Not found here, let's try one up
      const parentDir = Uri.ensureTrailingSlash(Uri.joinPath(dir, '..'));

      // Skip infinite recursion
      if (Uri.equals(uri, parentDir)) {
        return {
          found: false,
          packageJson: null,
          uri: null,
        };
      }

      return readPackageJsonOrRecurse(parentDir);
    };

    return readPackageJsonOrRecurse(containingDirUrl);
  }
}
