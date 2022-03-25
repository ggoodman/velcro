import { Context, withTimeout } from '@ggoodman/context';
import { fetch } from 'undici';
import { TextDecoder } from 'util';
import { PackageEntry, PackageFileListing } from './files';
import {
  CanonicalizedModuleReference,
  isCanonicalizedModuleReference,
  ModuleReference,
  ModuleReferenceImpl,
} from './references';
import {
  assertEntriesListing,
  assertPackageJsonWithNameAndVersion,
  PackageListingDirectory,
  PackageListingFile,
} from './types';
import { signalForContext } from './util/context';
import { isThenable } from './util/thenables';

export interface ResolverCdn {
  readonly baseUrl: Readonly<URL>;

  urlForBareModule(name: string, range?: string, path?: string): URL;

  createReference(
    name: string,
    range: string,
    path: string,
    options?: { isCanonicalized?: boolean }
  ): ModuleReference;

  canonicalizeRef(
    ctx: Context,
    ref: ModuleReference
  ): Promise<CanonicalizedModuleReference> | CanonicalizedModuleReference;

  listEntries(
    ctx: Context,
    name: string,
    version: string
  ): Promise<PackageFileListing> | PackageFileListing;

  readFileContents(
    ctx: Context,
    ref: CanonicalizedModuleReference
  ): Promise<ArrayBuffer> | ArrayBuffer;
}

export class JsDelivrCdn implements ResolverCdn {
  private readonly baseContentHref = 'https://cdn.jsdelivr.net/npm/';
  private readonly baseApiHref = 'https://data.jsdelivr.com/v1/package/npm/';
  private readonly pendingFileReads: Map<string, Promise<ArrayBuffer>> =
    new Map();
  private readonly cachedFileReads: Map<string, ArrayBuffer> = new Map();
  private readonly decoder = new TextDecoder();

  public readonly baseUrl = new URL(this.baseContentHref);

  canonicalizeRef(
    ctx: Context,
    ref: ModuleReference<boolean>
  ): CanonicalizedModuleReference | Promise<CanonicalizedModuleReference> {
    if (isCanonicalizedModuleReference(ref)) {
      return ref;
    }

    const createRefFromPackageJson = (
      packageJsonData: ArrayBuffer
    ): CanonicalizedModuleReference => {
      const packageJson = JSON.parse(this.decoder.decode(packageJsonData));

      assertPackageJsonWithNameAndVersion(packageJson);

      return ref.canonicalizedWith({
        spec: packageJson.version,
      });
    };

    const packageJsonRef = ref.with({
      path: '/package.json',
    });
    const packageJsonDataRet = this.readUrl(ctx, packageJsonRef.url);

    return isThenable(packageJsonDataRet)
      ? packageJsonDataRet.then(createRefFromPackageJson)
      : createRefFromPackageJson(packageJsonDataRet);
  }

  createReference(
    name: string,
    range: string,
    path?: string,
    options?: { isCanonicalized?: boolean | undefined }
  ): ModuleReference<boolean> {
    return new ModuleReferenceImpl(
      this,
      name,
      range,
      path ?? '',
      !!options?.isCanonicalized
    );
  }

  urlForBareModule(name: string, range = '*', path = '') {
    return new URL(`./${name}@${range}${path}`, this.baseContentHref);
  }

  private readUrl(ctx: Context, url: URL) {
    const href = url.toString();
    const cached = this.cachedFileReads.get(href);
    if (cached) {
      return cached;
    }

    let pending = this.pendingFileReads.get(href);
    if (!pending) {
      pending = fetch(href, {
        signal: signalForContext(withTimeout(ctx, 5000).ctx),
      }).then((res) => res.arrayBuffer());

      this.pendingFileReads.set(href, pending);

      // Flip completed reads into cache and delete pending operations
      pending.then(
        (buf) => {
          this.pendingFileReads.delete(href);
          this.cachedFileReads.set(href, buf);
        },
        () => {
          this.pendingFileReads.delete(href);
        }
      );
    }

    return pending;
  }

  listEntries(
    ctx: Context,
    name: string,
    version: string
  ): Promise<PackageFileListing> | PackageFileListing {
    const listingUrl = new URL(`./${name}@${version}/tree`, this.baseApiHref);
    const dataRet = this.readUrl(ctx, listingUrl);

    const onListEntriesData = (data: ArrayBuffer) => {
      const json = JSON.parse(this.decoder.decode(data));

      assertEntriesListing(json);

      const entries = json.files.map((entry) => mapEntry(entry, baseRef));

      return new PackageFileListing(entries);
    };

    const mapEntry = (
      entry: PackageListingDirectory | PackageListingFile,
      parentRef: ModuleReference
    ): PackageEntry => {
      switch (entry.type) {
        case 'directory': {
          const ref = parentRef.withRelativePath(`./${entry.name}/`);
          return {
            type: 'directory',
            ref,
            entries: entry.files
              ? entry.files.map((entry) => mapEntry(entry, ref))
              : [],
          };
        }
        case 'file': {
          const ref = parentRef.withRelativePath(`./${entry.name}`);
          return {
            type: 'file',
            ref,
          };
        }
      }
    };

    const baseRef = this.createReference(name, version, '/');

    return isThenable(dataRet)
      ? dataRet.then(onListEntriesData)
      : onListEntriesData(dataRet);
  }

  readFileContents(ctx: Context, ref: ModuleReference) {
    return this.readUrl(ctx, ref.url);
  }

  readFileContentsAsJson(ctx: Context, ref: ModuleReference) {
    const packageJsonDataRet = this.readUrl(ctx, ref.url);

    return isThenable(packageJsonDataRet)
      ? packageJsonDataRet
          .then(this.decoder.decode.bind(this.decoder))
          .then(parseJSON)
      : parseJSON(this.decoder.decode(packageJsonDataRet));
  }
}

function parseJSON(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (err) {
    return Promise.reject(err);
  }
}
