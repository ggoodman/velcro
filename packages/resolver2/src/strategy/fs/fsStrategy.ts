import { ResolverContext } from '../../context';
import { NotResolvableError } from '../../error';
import {
  AbstractResolverStrategyWithRoot,
  CanonicalizeResult,
  ListEntriesResult,
  ResolvedEntryKind,
} from '../../strategy';
import { Uri } from '../../util/uri';

export namespace FsStrategy {
  export type Dirent = {
    isFile(): boolean;
    isDirectory(): boolean;
    name: string;
  };

  export interface FsInterface {
    promises: {
      readdir(path: string, options: { encoding: 'utf-8'; withFileTypes: true }): Promise<Dirent[]>;
      readFile(path: string): Promise<ArrayBuffer>;
      realpath(path: string): Promise<string>;
    };
  }

  export interface Options {
    fs: FsInterface;
    rootUri?: Uri;
  }
}

export class FsStrategy extends AbstractResolverStrategyWithRoot {
  private readonly fs: FsStrategy.FsInterface;

  constructor(options: FsStrategy.Options) {
    super(options.rootUri || Uri.file('/'));

    this.fs = options.fs;
  }

  private ensureUriUnderRoot(uri: Uri) {
    if (!Uri.isPrefixOf(this.rootUri, uri)) {
      return new NotResolvableError(
        `The URI '${uri}' is not under the root for this resolver strategy '${this.rootUri}'`
      );
    }
  }

  async getCanonicalUrl(_ctx: ResolverContext, uri: Uri): Promise<CanonicalizeResult> {
    const err = this.ensureUriUnderRoot(uri);

    if (err) {
      throw err;
    }

    try {
      const realpath = await this.fs.promises.realpath(uri.fsPath);

      return {
        uri: Uri.file(realpath),
      };
    } catch (err) {
      if (err?.code === 'ENOENT') {
        return {
          uri,
        };
      }

      throw err;
    }
  }

  getRootUrl() {
    return { uri: this.rootUri };
  }

  getResolveRoot(_ctx: ResolverContext, uri: Uri) {
    const err = this.ensureUriUnderRoot(uri);

    if (err) {
      return Promise.reject(err);
    }

    return { uri: this.rootUri };
  }

  async listEntries(_ctx: ResolverContext, uri: Uri) {
    const err = this.ensureUriUnderRoot(uri);

    if (err) {
      throw err;
    }

    const fsEntries = await this.fs.promises.readdir(uri.fsPath, {
      encoding: 'utf-8',
      withFileTypes: true,
    });
    const result: ListEntriesResult = { entries: [] };

    for (const entry of fsEntries) {
      if (entry.isDirectory()) {
        result.entries.push({
          type: ResolvedEntryKind.Directory,
          uri: Uri.joinPath(uri, entry.name),
        });
      } else if (entry.isFile()) {
        result.entries.push({
          type: ResolvedEntryKind.File,
          uri: Uri.joinPath(uri, entry.name),
        });
      }
    }

    return result;
  }

  async readFileContent(_ctx: ResolverContext, uri: Uri) {
    const err = this.ensureUriUnderRoot(uri);

    if (err) {
      throw err;
    }

    const content = await this.fs.promises.readFile(uri.fsPath);

    return {
      content,
    };
  }
}
