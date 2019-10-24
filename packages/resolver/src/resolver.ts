import { CancellationToken, CancellationTokenSource } from './cancellation';
import { Decoder } from './decoder';
import { PackageMainField, ResolvedEntry, ResolvedEntryKind, PackageJson, ResolveDetails } from './types';
import {
  parseBufferAsPackageJson,
  dirname,
  getFirstPathSegmentAfterPrefix,
  basename,
  resolve,
  ensureTrailingSlash,
  extname,
} from './util';
import { EntryNotFoundError } from './error';
import { ResolverHost } from './resolver_host';
import { CanceledError } from 'ts-primitives';

const TRAILING_SLASH_RX = /\/?$/;

interface ResolverOptions {
  packageMain?: Array<PackageMainField>;
  extensions?: string[];
}

interface ResolverResolveOptions extends ResolverOptions {
  ignoreBrowserOverrides?: boolean;
  token?: CancellationToken;
}

interface NormalizedResolveOptions extends Required<ResolverResolveOptions> {}

export class Resolver {
  public static readonly defaultExtensions: ReadonlyArray<string> = [
    '.js',
    '.jsx',
    '.es6',
    '.es',
    '.mjs',
    '.ts',
    '.tsx',
    '.json',
  ];

  private readonly extensions: string[];
  private readonly packageMain: PackageMainField[];

  public readonly decoder = new Decoder();

  constructor(public readonly host: ResolverHost, options: ResolverOptions = {}) {
    this.extensions = Array.from(options.extensions || Resolver.defaultExtensions);
    this.packageMain = options.packageMain || ['main'];
  }

  async resolve(url: URL | string, options: Partial<ResolverResolveOptions> = {}): Promise<ResolveDetails> {
    if (!(url instanceof URL)) {
      try {
        url = new URL(url);
      } catch (err) {
        throw new Error(`Invalid URL: ${url}: ${err.message}`);
      }
    }

    let token = options.token;

    if (!token) {
      const tokenSource = new CancellationTokenSource();

      token = tokenSource.token;
    }

    const optionsWithDefaults: NormalizedResolveOptions = {
      extensions: options.extensions || this.extensions,
      ignoreBrowserOverrides:
        typeof options.ignoreBrowserOverrides === 'undefined' ? false : options.ignoreBrowserOverrides,
      packageMain: options.packageMain || this.packageMain,
      token,
    };

    const canonicalUrlPromise = this.host.getCanonicalUrl
      ? this.host.getCanonicalUrl(this, url, { token })
      : Promise.resolve(url);

    if (token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    // To figure out if the url should be resolved as a file or as a directory, we need to first canonicalize the url
    // if the host supports this and resolve the root url for the given asset.
    const [canonicalUrl, rootUrl] = await Promise.all([
      canonicalUrlPromise,
      this.host.getResolveRoot(this, url, { token }),
    ]);

    if (token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const rootHref = rootUrl.href;
    const rootHrefWithoutTrailingSlash = rootHref.replace(TRAILING_SLASH_RX, '');
    const canonicalHref = canonicalUrl.href;

    if (!canonicalHref.startsWith(rootHrefWithoutTrailingSlash)) {
      throw new Error(`Unable to resolve a module whose path ${canonicalHref} is above the host's root ${rootHref}`);
    }

    const resolvedUrl =
      rootHrefWithoutTrailingSlash === canonicalHref || rootHref == canonicalHref
        ? await this.resolveAsDirectory(canonicalUrl, optionsWithDefaults)
        : await this.resolveAsFile(canonicalUrl, optionsWithDefaults);

    if (token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    return {
      ignored: resolvedUrl === false,
      resolvedUrl: resolvedUrl || undefined,
      rootUrl,
    };
  }

  /**
   * Resolve a reference treating it as a directory
   *
   * 1. If there is a `package.json` file and this has a `main` entry, use that
   * 2. Assume `index` if no main file is found in the `package.json` manifest
   *
   * The outcome of this process will then be resolved as if it were a file.
   */
  private async resolveAsDirectory(url: URL, options: NormalizedResolveOptions): Promise<URL | false | undefined> {
    const [rootUrl, entries] = await Promise.all([
      this.host.getResolveRoot(this, url, { token: options.token }),
      this.host.listEntries(this, url, { token: options.token }),
    ]);

    if (options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    let mainPathname = 'index';

    // Step 1: Look for a package.json with an main field
    const packageJsonEntry = entries.find(entry => basename(entry.url.pathname) === 'package.json');

    if (packageJsonEntry) {
      const packageJsonContent = await this.host.readFileContent(this, packageJsonEntry.url, { token: options.token });

      if (options.token.isCancellationRequested) {
        throw new CanceledError('Canceled');
      }

      const packageJson = parseBufferAsPackageJson(this.decoder, packageJsonContent, url.href);

      for (const packageMain of this.packageMain) {
        const pathname = packageJson[packageMain];
        if (typeof pathname === 'string') {
          mainPathname = pathname;
          break;
        }
      }
    }

    const mainUrl = new URL(resolve(url.pathname, mainPathname), rootUrl);

    return this.resolveAsFile(mainUrl, options);
  }

  /**
   * Resolve a reference treating it as a file
   *
   * 1. List entries in the containing directory
   * 2. Look for an exact file match or a file match with one of the supplied extensions
   * 3. Look for a matching child directory and attempt to resolve that as a directory
   */
  private async resolveAsFile(url: URL, options: NormalizedResolveOptions): Promise<URL | false | undefined> {
    if (url.pathname === '' || url.pathname === '/') {
      throw new TypeError(`Unable to resolve the root as a file: ${url.href}`);
    }

    const rootUrl = await this.host.getResolveRoot(this, url, { token: options.token });

    if (options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    // The parent package.json is only interesting if we are going to look at the `browser`
    // field and then consider browser mapping overrides in there.
    const parentPackageJson =
      this.packageMain.includes('browser') && !options.ignoreBrowserOverrides
        ? await this.readParentPackageJson(url, { token: options.token })
        : undefined;

    if (options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const browserOverrides = new Map<string, URL | false>();

    if (parentPackageJson && typeof parentPackageJson.packageJson.browser === 'object') {
      const browserMap = parentPackageJson.packageJson.browser;
      const packageJsonDir = dirname(parentPackageJson.url.pathname);

      for (const entry in browserMap) {
        const impliedUrl = new URL(resolve(packageJsonDir, entry), parentPackageJson.url);
        const targetSpec = browserMap[entry];
        const target =
          targetSpec === false ? false : new URL(resolve(packageJsonDir, targetSpec), parentPackageJson.url);

        if (impliedUrl.href === url.href) {
          if (target === false) {
            return false;
          }

          // console.warn('REMAPPED %s to %s', url, target);

          // We found an exact match so let's make sure we resolve the re-mapped file but
          // also that we don't go through the browser overrides rodeo again.
          return this.resolveAsFile(target, { ...options, ignoreBrowserOverrides: true });
        }

        browserOverrides.set(impliedUrl.href, target);
      }
    }

    const containingUrl = new URL(ensureTrailingSlash(dirname(url.pathname)), rootUrl);
    const filename = basename(url.pathname);
    const entries = await this.host.listEntries(this, containingUrl, { token: options.token });

    if (options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const entryDirectoryMap = new Map<string, ResolvedEntry>();
    const entryFileMap = new Map<string, ResolvedEntry>();

    for (const entry of entries) {
      if (entry.url.href === url.href && entry.type == ResolvedEntryKind.File) {
        // Found an exact match
        return entry.url;
      }

      if (entry.type === ResolvedEntryKind.Directory) {
        const childFilename = getFirstPathSegmentAfterPrefix(entry.url, containingUrl);

        entryDirectoryMap.set(childFilename, entry);
      } else if (entry.type === ResolvedEntryKind.File) {
        const childFilename = basename(entry.url.pathname);

        entryFileMap.set(childFilename, entry);
      }
    }

    // Look for browser overrides
    for (const ext of options.extensions) {
      const mapping = browserOverrides.get(`${url.href}${ext}`);

      if (mapping === false) {
        // console.warn('REMAPPED %s to undefined', url);
        return false;
      } else if (mapping) {
        // console.warn('REMAPPED %s to %s', url, mapping);

        return this.resolveAsFile(mapping, { ...options, ignoreBrowserOverrides: true });
      }

      const match = entryFileMap.get(`${filename}${ext}`);
      if (match) {
        if (match.type !== ResolvedEntryKind.File) {
          continue;
        }

        return match.url;
      }
    }

    // First, attempt to find a matching file or directory
    const match = entryDirectoryMap.get(filename);
    if (match) {
      if (match.type !== ResolvedEntryKind.Directory) {
        throw new Error(`Invariant violation ${match.type} is unexpected`);
      }

      return this.resolveAsDirectory(match.url, options);
    }

    throw new EntryNotFoundError(url);
  }

  public async readParentPackageJson(
    url: URL,
    options: { token?: CancellationToken } = {}
  ): Promise<{ packageJson: PackageJson; url: URL } | undefined> {
    url = await this.host.getCanonicalUrl(this, url, { token: options.token });

    if (options.token && options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const hostRootUrl = await this.host.getResolveRoot(this, url, { token: options.token });

    if (options.token && options.token.isCancellationRequested) {
      throw new CanceledError('Canceled');
    }

    const hostRootHref = ensureTrailingSlash(hostRootUrl.href);
    const containingDirUrl = new URL(ensureTrailingSlash(dirname(url.pathname)), url);

    const readPackageJsonOrRecurse = async (dir: URL): Promise<{ packageJson: PackageJson; url: URL } | undefined> => {
      if (!dir.href.startsWith(hostRootHref)) {
        // Terminal condition for recursion
        return undefined;
      }

      const entries = await this.host.listEntries(this, dir, { token: options.token });

      if (options.token && options.token.isCancellationRequested) {
        throw new CanceledError('Canceled');
      }

      const packageJsonEntry = entries.find(
        entry => entry.type === ResolvedEntryKind.File && entry.url.pathname.endsWith('/package.json')
      );

      if (packageJsonEntry) {
        // Found! Let's try to parse
        try {
          const parentPackageJsonContent = await this.host.readFileContent(this, packageJsonEntry.url, {
            token: options.token,
          });

          if (options.token && options.token.isCancellationRequested) {
            throw new CanceledError('Canceled');
          }

          const packageJson = parseBufferAsPackageJson(
            this.decoder,
            parentPackageJsonContent,
            packageJsonEntry.url.href
          );

          return { packageJson, url: packageJsonEntry.url };
        } catch (err) {
          if (err instanceof CanceledError || (err && err.name === 'CanceledError')) {
            throw err;
          }

          console.warn(
            `Error reading the parent package manifest for ${url.href} from ${packageJsonEntry.url.href}: ${err.message}`
          );
        }
      }

      // Not found here, let's try one up
      const parentDir = new URL(ensureTrailingSlash(dirname(dir.pathname)), dir);

      // Skip infinite recursion
      if (parentDir.href === dir.href) {
        return undefined;
      }

      return readPackageJsonOrRecurse(parentDir);
    };

    return readPackageJsonOrRecurse(containingDirUrl);
  }

  static path = {
    basename,
    dirname,
    extname,
    resolve,
  };
}
