import { NotResolvableError } from '../../error';
import {
  AbstractResolverStrategy,
  CanonicalizeResult,
  ListEntriesResult,
  ResolvedEntryKind,
} from '../../strategy';
import { Uri } from '../../uri';
import { FsInterface } from './types';

interface ResolverHostFsOptions {
  fs: FsInterface;
  rootUri?: Uri;
}

export class FsStrategy extends AbstractResolverStrategy {
  private readonly fs: FsInterface;
  private readonly rootUri: Uri;

  constructor(options: ResolverHostFsOptions) {
    super();

    this.fs = options.fs;
    this.rootUri = options.rootUri || Uri.file('/');
  }

  private ensureUriUnderRoot(uri: Uri) {
    if (!this.canResolve(uri)) {
      return new NotResolvableError(
        `The URI '${uri}' is not under the root for this resolver strategy '${this.rootUri}'`
      );
    }
  }

  canResolve(uri: Uri) {
    return Uri.isPrefixOf(this.rootUri, uri);
  }

  async getCanonicalUrl(uri: Uri): Promise<CanonicalizeResult> {
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

  getResolveRoot(uri: Uri) {
    const err = this.ensureUriUnderRoot(uri);

    if (err) {
      return Promise.reject(err);
    }

    return { uri: this.rootUri };
  }

  async listEntries(uri: Uri) {
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

  async readFileContent(uri: Uri) {
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
