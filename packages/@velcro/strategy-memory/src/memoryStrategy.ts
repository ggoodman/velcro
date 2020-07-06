import { Uri } from '@velcro/common';
import {
  AbstractResolverStrategyWithRoot,
  ResolverContext,
  ResolverStrategy,
} from '@velcro/resolver';

interface DirectoryEntry {
  type: ResolverStrategy.EntryKind.Directory;
  children: Record<string, Entry>;
}

enum FileEncoding {
  Base64 = 'base64',
  UTF8 = 'utf-8',
}

interface FileEntry {
  type: ResolverStrategy.EntryKind.File;
  content: string;
  encoding: FileEncoding;
}

interface FileInputWithEncoding {
  encoding: FileEncoding;
  content: string;
}

type Entry = DirectoryEntry | FileEntry;
type FileInput = string | FileInputWithEncoding;

const encodeText =
  typeof TextEncoder === 'function'
    ? (function () {
        const encoder = new TextEncoder();

        return function encodeText(data: string): ArrayBuffer {
          return encoder.encode(data).buffer;
        };
      })()
    : typeof Buffer === 'function'
    ? function encodeText(data: string): ArrayBuffer {
        return Buffer.from(data);
      }
    : function encodeText(_data: string): ArrayBuffer {
        throw new Error(
          'The environment provides neither TextEncoder nor Buffer. Please consider polyfilling one of these APIs.'
        );
      };

export class MemoryStrategy extends AbstractResolverStrategyWithRoot {
  private readonly root: DirectoryEntry = {
    type: ResolverStrategy.EntryKind.Directory,
    children: {},
  };

  constructor(files: Record<string, FileInput>, rootUri = Uri.parse('memory:/')) {
    super(Uri.ensureTrailingSlash(rootUri));

    for (const pathname in files) {
      const file = files[pathname];

      if (typeof file === 'string') {
        this.addFile(pathname, file);
      } else {
        this.addFile(pathname, file.content, { encoding: file.encoding });
      }
    }
  }

  getEntryAtPath(pathname: string) {
    const segments = Array.isArray(pathname)
      ? pathname.slice()
      : pathname.split('/').filter(Boolean);

    let parent: Entry = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== ResolverStrategy.EntryKind.Directory) {
        throw new Error(`Failed to add ${pathname}`);
      }

      parent = parent.children[segment];
    }

    return parent;
  }

  addFile(
    pathname: string,
    content: string,
    {
      encoding = FileEncoding.UTF8,
      overwrite = false,
    }: { encoding?: FileEncoding; overwrite?: boolean } = {}
  ) {
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments.pop();

    if (!filename) {
      throw new Error(`Unable to add a file without a filename '${pathname}'`);
    }

    let parent: Entry = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== ResolverStrategy.EntryKind.Directory) {
        throw new Error(`Failed to add ${pathname}`);
      }

      let dir: Entry = parent.children[segment];

      if (!dir) {
        dir = {
          type: ResolverStrategy.EntryKind.Directory,
          children: {},
        };

        parent.children[segment] = dir;
      }

      parent = dir;
    }

    if (parent.type !== ResolverStrategy.EntryKind.Directory) {
      throw new Error(`Cannot add file to a non directory entry ${pathname}`);
    }

    if (parent.children[filename] && !overwrite) {
      throw new Error(`Entry already exists at ${pathname}`);
    }

    const entry: FileEntry = {
      type: ResolverStrategy.EntryKind.File,
      content,
      encoding,
    };

    parent.children[filename] = entry;

    return entry;
  }

  removeFile(pathname: string) {
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments.pop();

    if (!filename) {
      return false;
    }

    let parent: Entry = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== ResolverStrategy.EntryKind.Directory) {
        return false;
      }

      parent = parent.children[segment];
    }

    if (!parent || parent.type !== ResolverStrategy.EntryKind.Directory) {
      return false;
    }

    return delete parent.children[filename];
  }

  getResolveRoot() {
    return {
      uri: this.rootUri,
    };
  }

  listEntries(_ctx: ResolverContext, uri: Uri) {
    const urlPathname = Uri.ensureTrailingSlash(uri).fsPath;
    const basePathname = this.rootUri.fsPath;
    const fsPathname = urlPathname.startsWith(basePathname)
      ? urlPathname.slice(basePathname.length - 1)
      : urlPathname;
    const parent = this.getEntryAtPath(fsPathname);

    if (!parent) {
      throw new Error(`No such directory ${uri.toString()}`);
    }

    if (parent.type !== ResolverStrategy.EntryKind.Directory) {
      throw new Error(`Cannot list entries under a file at ${uri.toString()}`);
    }

    const entries = Object.keys(parent.children).map((filename) => {
      const entry = parent.children[filename];

      return {
        uri: Uri.joinPath(this.rootUri, fsPathname, filename),
        type: entry.type,
      };
    });

    return {
      entries,
    };
  }

  readFileContent(_ctx: ResolverContext, uri: Uri) {
    const urlPathname = Uri.ensureTrailingSlash(uri).fsPath;
    const basePathname = this.rootUri.fsPath;
    const fsPathname = urlPathname.startsWith(basePathname)
      ? urlPathname.slice(basePathname.length - 1)
      : urlPathname;
    const entry = this.getEntryAtPath(fsPathname);

    if (!entry) {
      throw new Error(`No such file ${uri.toString()}`);
    }

    if (entry.type !== 'file') {
      throw new Error(`Cannot read content of a non-file at ${uri.toString()}`);
    }

    switch (entry.encoding) {
      case FileEncoding.Base64: {
        const binSting = atob(entry.content);
        const binArray = new Uint8Array(binSting.length);

        Array.prototype.forEach.call(binArray, function (_el: any, idx: number, arr: number[]) {
          arr[idx] = binSting.charCodeAt(idx);
        });

        return {
          content: binArray.buffer,
        };
      }
      case FileEncoding.UTF8: {
        return {
          content: encodeText(entry.content),
        };
      }
      default:
        throw new Error(`Unsupported encoding for ${uri.toString()}: ${entry.encoding}`);
    }
  }

  uriForPath(pathname: string) {
    return Uri.joinPath(this.rootUri, pathname);
  }
}
