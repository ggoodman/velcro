import { ResolvedEntry } from './types';
import { Resolver } from './resolver';

export abstract class ResolverHost {
  /**
   * Get the canonical url for this resource
   *
   * This might involve traversing symlinks or following redirects. The idea is to provide
   * an optional mechanism for hosts dereference links to the canonical form.
   */
  getCanonicalUrl(_resolver: Resolver, url: URL): Promise<URL> {
    return Promise.resolve(url);
  }

  /**
   * Get the URL that should be treated as the resolution root for this host
   */
  abstract getResolveRoot(resolver: Resolver, url: URL): Promise<URL>;

  /**
   * List the entries that are children of the given url, assuming this refers to a directory
   */
  abstract listEntries(resolver: Resolver, url: URL): Promise<ResolvedEntry[]>;

  /**
   * Read the content of a url as a file and produce a buffer
   */
  abstract readFileContent(resolver: Resolver, url: URL): Promise<ArrayBuffer>;
}
