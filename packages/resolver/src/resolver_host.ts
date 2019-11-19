import { Resolver } from './resolver';
import { ResolvedEntry } from './types';
import { CancellationToken } from './cancellation';

export interface ResolverHostOperationOptions {
  invalidatedBy?: Set<string>;
  token?: CancellationToken;
}

export interface ResolverHost {
  /**
   * Get the canonical url for this resource
   *
   * This might involve traversing symlinks or following redirects. The idea is to provide
   * an optional mechanism for hosts dereference links to the canonical form.
   */
  getCanonicalUrl(_resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<URL>;

  /**
   * Get the URL that should be treated as the resolution root for this host
   */
  getResolveRoot(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<URL>;

  /**
   * List the entries that are children of the given url, assuming this refers to a directory
   */
  listEntries(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<ResolvedEntry[]>;

  /**
   * Read the content of a url as a file and produce a buffer
   */
  readFileContent(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<ArrayBuffer>;
}

export abstract class AbstractResolverHost implements ResolverHost {
  getCanonicalUrl(_resolver: Resolver, url: URL): Promise<URL> {
    return Promise.resolve(url);
  }

  abstract getResolveRoot(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<URL>;

  abstract listEntries(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<ResolvedEntry[]>;

  abstract readFileContent(resolver: Resolver, url: URL, options?: ResolverHostOperationOptions): Promise<ArrayBuffer>;
}
