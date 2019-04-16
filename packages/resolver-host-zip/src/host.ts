import { ResolverHost, Resolver, util, ResolvedEntry, ResolvedEntryKind } from '@velcro/resolver';
import Zip from 'jszip';

import { CustomFetch } from './types';

interface ResolverHostZipOptions {
  zipUrl: string;
  fetch?: CustomFetch;
}

export class ResolverHostZip extends ResolverHost {
  private readonly fetch: CustomFetch;
  private readonly url: URL;
  private zipPromise: Promise<Zip> | undefined = undefined;

  constructor(options: ResolverHostZipOptions) {
    super();

    if (!options.fetch && typeof fetch !== 'function') {
      throw new TypeError(
        `A fetch function must be provided to the ${this.constructor.name} if the environment doesn't provide one`
      );
    }

    this.fetch = options.fetch || ((input: RequestInfo, init?: RequestInit | undefined) => fetch(input, init));
    this.url = new URL(options.zipUrl);
  }

  private getZipPromise() {
    if (!this.zipPromise) {
      this.zipPromise = this.fetch(this.url.href).then(async res => {
        if (!res.ok) {
          return Promise.reject(new Error(`Error fetching zip file at ${this.url.href} with status ${res.status}`));
        }

        const content = await res.arrayBuffer();

        return Zip.loadAsync(content, {
          createFolders: true,
        });
      });
    }

    return this.zipPromise;
  }

  getResolveRoot() {
    return Promise.resolve(this.url);
  }

  async listEntries(_resolver: Resolver, url: URL) {
    const baseHref = util.ensureTrailingSlash(this.url.href);

    if (!url.href.startsWith(baseHref)) {
      throw new Error(`Unable to list entries for ${url.href} because it is outside the zip root at ${this.url.href}`);
    }

    const zip = await this.getZipPromise();
    const dirname = util.stripTrailingSlash(url.href.slice(baseHref.length));
    const files = zip.folder(dirname).files;
    const entries = [] as ResolvedEntry[];

    for (const filename in files) {
      const file = files[filename];
      const url = new URL(util.resolve(dirname, file.name), this.url);

      entries.push({
        type: file.dir ? ResolvedEntryKind.Directory : ResolvedEntryKind.File,
        url,
      });
    }

    return entries;
  }

  async readFileContent(_resolver: Resolver, url: URL) {
    const baseHref = util.ensureTrailingSlash(this.url.href);

    if (!url.href.startsWith(baseHref)) {
      throw new Error(`Unable to list entries for ${url.href} because it is outside the zip root at ${this.url.href}`);
    }

    const zip = await this.getZipPromise();
    const pathname = util.stripTrailingSlash(url.href.slice(baseHref.length));

    return zip.file(pathname).async('arraybuffer');
  }
}
