import { ResolvedEntryKind, util, Resolver, ResolverHost } from '@velcro/resolver';

interface DirectoryEntry {
  type: ResolvedEntryKind.Directory;
  children: Record<string, Entry>;
}

enum FileEncoding {
  Base64 = 'base64',
  UTF8 = 'utf-8',
}

interface FileEntry {
  type: ResolvedEntryKind.File;
  content: string;
  encoding: FileEncoding;
}

interface FileInputWithEncoding {
  encoding: FileEncoding;
  content: string;
}

type Entry = DirectoryEntry | FileEntry;
type FileInput = string | FileInputWithEncoding;

export class ResolverHostMemory extends ResolverHost {
  private readonly baseUrl: URL;
  private readonly root: DirectoryEntry = {
    type: ResolvedEntryKind.Directory,
    children: {},
  };

  private readonly textEncoder = new TextEncoder();

  constructor(files: Record<string, FileInput>, basePath: string = `${Date.now()}`) {
    super();

    this.baseUrl = new URL(util.ensureTrailingSlash(basePath), 'memory:/');

    for (const pathname in files) {
      const file = files[pathname];

      if (typeof file === 'string') {
        this.addFile(pathname, file);
      } else {
        this.addFile(pathname, file.content, file.encoding);
      }
    }
  }

  getEntryAtPath(pathname: string) {
    const segments = Array.isArray(pathname) ? pathname.slice() : pathname.split('/').filter(Boolean);

    let parent: Entry = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== ResolvedEntryKind.Directory) {
        throw new Error(`Failed to add ${pathname}`);
      }

      parent = parent.children[segment];
    }

    return parent;
  }

  addFile(pathname: string, content: string, encoding: FileEncoding = FileEncoding.UTF8) {
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments.pop();

    if (!filename) {
      throw new Error(`Unable to add a file without a filename '${pathname}'`);
    }

    let parent: Entry = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== ResolvedEntryKind.Directory) {
        throw new Error(`Failed to add ${pathname}`);
      }

      let dir: Entry = parent.children[segment];

      if (!dir) {
        dir = {
          type: ResolvedEntryKind.Directory,
          children: {},
        };

        parent.children[segment] = dir;
      }

      parent = dir;
    }

    if (parent.type !== ResolvedEntryKind.Directory) {
      throw new Error(`Cannot add file to a non directory entry ${pathname}`);
    }

    if (parent.children[filename]) {
      throw new Error(`Entry already exists at ${pathname}`);
    }

    const entry: FileEntry = {
      type: ResolvedEntryKind.File,
      content,
      encoding,
    };

    parent.children[filename] = entry;

    return entry;
  }

  async getResolveRoot() {
    return this.baseUrl;
  }

  async listEntries(_resolver: Resolver, url: URL) {
    const urlPathname = util.ensureTrailingSlash(url.pathname);
    const basePathname = this.baseUrl.pathname;
    const fsPathname = urlPathname.startsWith(basePathname) ? urlPathname.slice(basePathname.length - 1) : urlPathname;
    const parent = this.getEntryAtPath(fsPathname);

    if (!parent) {
      throw new Error(`No such directory ${url.href}`);
    }

    if (parent.type !== ResolvedEntryKind.Directory) {
      throw new Error(`Cannot list entries under a file at ${url.href}`);
    }

    return Object.keys(parent.children).map(filename => {
      const entry = parent.children[filename];

      return {
        url: this.urlFromPath(util.join(fsPathname, filename)),
        type: entry.type,
      };
    });
  }

  async readFileContent(_resolver: Resolver, url: URL) {
    const urlPathname = util.ensureTrailingSlash(url.pathname);
    const basePathname = this.baseUrl.pathname;
    const fsPathname = urlPathname.startsWith(basePathname) ? urlPathname.slice(basePathname.length - 1) : urlPathname;
    const entry = this.getEntryAtPath(fsPathname);

    if (!entry) {
      throw new Error(`No such file ${url.href}`);
    }

    if (entry.type !== 'file') {
      throw new Error(`Cannot read content of a non-file at ${url.href}`);
    }

    switch (entry.encoding) {
      case FileEncoding.Base64: {
        const binSting = atob(entry.content);
        const binArray = new Uint8Array(binSting.length);

        Array.prototype.forEach.call(binArray, function(_el: any, idx: number, arr: number[]) {
          arr[idx] = binSting.charCodeAt(idx);
        });

        return binArray.buffer;
      }
      case FileEncoding.UTF8: {
        return this.textEncoder.encode(entry.content).buffer;
      }
      default:
        throw new Error(`Unsupported encoding for ${url.href}: ${entry.encoding}`);
    }
  }

  urlFromPath(pathname: string): URL {
    return new URL(util.join(this.baseUrl.pathname, pathname), this.baseUrl);
  }
}
