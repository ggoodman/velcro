import { Context, withTimeout } from '@ggoodman/context';
import { build } from 'esbuild';
import { fetch } from 'undici';
import { TextDecoder } from 'util';

const SPEC_RX = /^((@[^/]+\/[^/@]+|[^./@][^/@]*)(?:@([^/]+))?)(\/.*)?$/;

function parseBareModuleSpec(bareModuleSpec: string) {
  const matches = bareModuleSpec.match(SPEC_RX);

  if (matches) {
    const [, nameSpec, name, spec, path = ''] = matches as [
      string,
      string,
      string,
      string,
      string | undefined
    ];

    return {
      nameSpec,
      name,
      spec,
      path,
    };
  }

  return null;
}

export class JsDelivrCdn {
  private baseContentHref = 'https://cdn.jsdelivr.net/npm/';
  private baseApiHref = 'https://data.jsdelivr.com/v1/package/npm/';
  private pendingFileReads: Map<string, Promise<ArrayBuffer>> = new Map();
  private cachedFileReads: Map<string, ArrayBuffer> = new Map();
  private decoder = new TextDecoder();

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
        compress: true,
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

  listEntries(ctx: Context, name: string, version: string) {
    const listingUrl = new URL(`./${name}@${version}/tree`, this.baseApiHref);
    const dataRet = this.readUrl(ctx, listingUrl);
    const onListEntriesData = (data: ArrayBuffer) => {
      const json = JSON.parse(this.decoder.decode(data));

      assertEntriesListing(json);

      const entries = json.files.map((entry) => mapEntry(entry, baseUrl));

      return new PackageFiles(entries);
    };
    const mapEntry = (
      entry: PackageListingDirectory | PackageListingFile,
      parentUrl: URL
    ): PackageEntryReference => {
      const url = new URL(`./${entry.name}`, parentUrl);
      switch (entry.type) {
        case 'directory': {
          return new PackageDirectoryReference(
            url,
            entry.files ? entry.files.map((entry) => mapEntry(entry, url)) : []
          );
        }
        case 'file': {
          return new PackageFileReference(url);
        }
      }
    };

    const baseUrl = this.urlForBareModule(name, version, '/');

    return isThenable(dataRet)
      ? dataRet.then(onListEntriesData)
      : onListEntriesData(dataRet);
  }

  readFileContents(ctx: Context, url: URL) {
    return this.readUrl(ctx, url);
  }
}

class PackageFiles {
  private readonly entries: ReadonlyArray<PackageEntryReference>;

  constructor(entries: Array<PackageEntryReference>) {
    this.entries = entries;
  }

  toJSON() {
    return {
      entries: this.entries.map((entry) => entry.toJSON()),
    };
  }
}

interface PackageFileReferenceJson {
  readonly type: 'file';
  readonly href: string;
}
class PackageFileReference {
  public readonly type = 'file';
  public readonly url: URL;

  constructor(url: URL) {
    this.url = url;
  }

  toJSON(): PackageFileReferenceJson {
    return {
      type: this.type,
      href: this.url.toString(),
    };
  }
}

interface PackageDirectoryReferenceJson {
  readonly type: 'directory';
  readonly href: string;
  readonly entries: ReadonlyArray<
    PackageDirectoryReferenceJson | PackageFileReferenceJson
  >;
}
class PackageDirectoryReference {
  public readonly type = 'directory';
  public readonly url: URL;
  public readonly entries: ReadonlyArray<PackageEntryReference>;

  constructor(url: URL, entries: PackageEntryReference[]) {
    this.url = url;
    this.entries = entries;
  }

  toJSON(): PackageDirectoryReferenceJson {
    return {
      type: this.type,
      href: this.url.toString(),
      entries: this.entries.map((entry) => entry.toJSON()),
    };
  }
}

type PackageEntryReference = PackageDirectoryReference | PackageFileReference;

export class BareModuleResolver {
  private cdn = new JsDelivrCdn();
  private decoder = new TextDecoder();

  async resolve(ctx: Context, spec: string) {
    const parsedSpec = parseBareModuleSpec(spec);

    if (!parsedSpec) {
      throw new TypeError(
        `Failed to parse ${JSON.stringify(spec)} as a bare module specifier`
      );
    }

    const packageJsonUrl = this.cdn.urlForBareModule(
      parsedSpec.name,
      parsedSpec.spec,
      '/package.json'
    );
    const packageJsonRet = this.cdn.readFileContents(ctx, packageJsonUrl);
    const packageJsonBuf = isThenable(packageJsonRet)
      ? await packageJsonRet
      : packageJsonRet;
    const packageJson = JSON.parse(this.decoder.decode(packageJsonBuf));

    assertPackageJsonWithNameAndVersion(packageJson);

    const url = this.cdn.urlForBareModule(
      packageJson.name,
      packageJson.version,
      parsedSpec.path
    );

    return {
      url,
    };
  }
}

class GraphBuilder {}

function isThenable<T>(obj: T | PromiseLike<T>): obj is PromiseLike<T> {
  return typeof (obj as PromiseLike<T>).then === 'function';
}

function signalForContext(ctx: Context): AbortSignal {
  const ac = new AbortController();

  ctx.onDidCancel(() => {
    ac.abort();
  });

  if (ctx.error()) {
    ac.abort();
  }

  return ac.signal;
}

interface PackageJsonWithNameAndVersion {
  name: string;
  version: string;
  [other: string]: unknown;
}
function assertPackageJsonWithNameAndVersion(
  obj: unknown
): asserts obj is PackageJsonWithNameAndVersion {
  assertObjectLike(obj, 'PackageJson');

  if (typeof obj['name'] !== 'string') {
    throw new TypeError(
      'The "name" property of a PackageJson object must be a string'
    );
  }

  if (typeof obj['version'] !== 'string') {
    throw new TypeError(
      'The "version" property of a PackageJson object must be a string'
    );
  }
}

interface PackageListing {
  default: string;
  files: Array<PackageListingDirectory | PackageListingFile>;
}
interface PackageListingDirectory {
  type: 'directory';
  name: string;
  files?: Array<PackageListingDirectory | PackageListingFile>;
}
interface PackageListingFile {
  type: 'file';
  name: string;
}
function assertEntriesListing(obj: unknown): asserts obj is PackageListing {
  assertObjectLike(obj, 'PackageListing');

  const files = obj['files'];
  if (!Array.isArray(files)) {
    throw new TypeError(
      `The .files property of a PackageListing must be an array`
    );
  }

  for (const idx in files) {
    assertPackageListingEntry(files[idx], `.files[${idx}]`);
  }
}

function assertPackageListingEntry(
  obj: unknown,
  path: string
): asserts obj is PackageListingDirectory | PackageListingFile {
  assertObjectLike(obj, path);

  const name = obj['name'];
  if (typeof name !== 'string') {
    throw new TypeError(`The .name property must be a string at ${path}`);
  }

  switch (obj['type']) {
    case 'directory': {
      const files = obj['files'];
      if (!Array.isArray(files)) {
        throw new TypeError(
          `The .files property of a PackageListing entry must be an array at ${path}`
        );
      }

      for (const idx in files) {
        assertPackageListingEntry(files[idx], `${path}.files[${idx}]`);
      }
      break;
    }
    case 'file': {
      break;
    }
    default: {
      throw new TypeError(
        `Unexpected .type property of a PackageListing entry at ${path}`
      );
    }
  }
}

interface ObjectLike {
  [name: string]: unknown;
}
function assertObjectLike(
  obj: unknown,
  kindName: string
): asserts obj is ObjectLike {
  if (obj == null || typeof obj !== 'object') {
    throw TypeError(`${kindName} variables must be objects`);
  }
}
