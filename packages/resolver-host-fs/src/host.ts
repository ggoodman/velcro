import { Resolver, ResolvedEntry, ResolvedEntryKind, ResolverHost } from '@velcro/resolver';

import { FsInterface } from './types';
import { util } from '@velcro/resolver';

const FILE_HOST = '';
const FILE_PROTOCOL = 'file:';

interface ResolverHostFsOptions {
  fs: FsInterface;
}

export class ResolverHostFs extends ResolverHost {
  private readonly fs: FsInterface;

  constructor(options: ResolverHostFsOptions) {
    super();

    this.fs = options.fs;
  }

  getCanonicalUrl(_resolver: Resolver, url: URL): Promise<URL> {
    if (url.protocol !== FILE_PROTOCOL || url.hostname !== FILE_HOST) {
      return Promise.reject(new Error(`Unable to list non-file:// entries for ${url.href}`));
    }

    return new Promise((resolve, reject) =>
      this.fs.realpath(url.pathname, (err, resolved) => {
        if (err) {
          return reject(err);
        }

        return resolve(new URL(resolved, url));
      })
    );
  }

  getResolveRoot(_resolver: Resolver, url: URL) {
    if (url.protocol !== FILE_PROTOCOL || url.hostname !== FILE_HOST) {
      return Promise.reject(new Error(`Unable to list non-file:// entries for ${url.href}`));
    }

    return Promise.resolve(new URL('/', url));
  }

  listEntries(_resolver: Resolver, url: URL) {
    if (url.protocol !== FILE_PROTOCOL || url.hostname !== FILE_HOST) {
      return Promise.reject(new Error(`Unable to list non-file:// entries for ${url.href}`));
    }

    const dirname = url.pathname;
    return new Promise<string[]>((resolve, reject) =>
      this.fs.readdir(dirname, (err, files) => {
        if (err) {
          return reject(err);
        }

        return resolve(files);
      })
    )
      .then(files =>
        files.length
          ? Promise.all(
              files.map(
                file =>
                  new Promise((resolve, reject) =>
                    this.fs.stat(util.join(dirname, file), (err, stats) => {
                      if (err) {
                        return reject(err);
                      }

                      if (stats.isDirectory()) {
                        const entry: ResolvedEntry = {
                          type: ResolvedEntryKind.Directory,
                          url: new URL(util.join(dirname, file), url),
                        };

                        return resolve(entry);
                      }

                      if (stats.isFile()) {
                        const entry: ResolvedEntry = {
                          type: ResolvedEntryKind.File,
                          url: new URL(util.join(dirname, file), url),
                        };

                        return resolve(entry);
                      }

                      return resolve();
                    })
                  )
              )
            )
          : []
      )
      .then(entries => entries.filter(Boolean) as ResolvedEntry[]);
  }

  readFileContent(_resolver: Resolver, url: URL) {
    if (url.protocol !== FILE_PROTOCOL || url.hostname !== FILE_HOST) {
      return Promise.reject(new Error(`Unable to list non-file:// entries for ${url.href}`));
    }

    return new Promise<ArrayBuffer>((resolve, reject) =>
      this.fs.readFile(url.pathname, (err, content) => {
        if (err) {
          return reject(err);
        }

        return resolve(content);
      })
    );
  }
}
