import { Resolver, AbstractResolverHost, ResolverHost } from '@velcro/resolver';

export class ResolverHostCompound extends AbstractResolverHost {
  private readonly hosts = new Map<string, ResolverHost>();
  constructor(hosts: Record<string, ResolverHost>) {
    super();

    for (const prefix in hosts) {
      this.hosts.set(prefix, hosts[prefix]);
    }
  }

  getCanonicalUrl(resolver: Resolver, url: URL) {
    const href = url.href;

    // TODO: Decide whether a more efficient solution is needed
    for (const [prefix, child] of this.hosts) {
      if (href.startsWith(prefix)) {
        if (typeof child.getCanonicalUrl === 'function') {
          // console.error(`getCanonicalUrl(%s): %s`, url.href, prefix);

          return child.getCanonicalUrl(resolver, url);
        }

        break;
      }
    }

    // If the resolved child doesn't have this method, treat it as an identity function
    return Promise.resolve(url);
  }

  getResolveRoot(resolver: Resolver, url: URL) {
    const href = url.href;

    // TODO: Decide whether a more efficient solution is needed
    for (const [prefix, child] of this.hosts) {
      if (href.startsWith(prefix)) {
        // console.error(`getResolveRoot(%s): %s`, url.href, prefix);

        return child.getResolveRoot(resolver, url);
      }
    }

    return Promise.reject(new Error(`No suitable host found for url ${href}`));
  }

  listEntries(resolver: Resolver, url: URL) {
    const href = url.href;

    // TODO: Decide whether a more efficient solution is needed
    for (const [prefix, child] of this.hosts) {
      if (href.startsWith(prefix)) {
        // console.error(`listEntries(%s): %s`, url.href, prefix);
        return child.listEntries(resolver, url);
      }
    }

    return Promise.reject(new Error(`No suitable host found for url ${href}`));
  }

  readFileContent(resolver: Resolver, url: URL) {
    const href = url.href;

    // TODO: Decide whether a more efficient solution is needed
    for (const [prefix, child] of this.hosts) {
      if (href.startsWith(prefix)) {
        // console.error(`readFileContent(%s): %s`, url.href, prefix);
        return child.readFileContent(resolver, url);
      }
    }

    return Promise.reject(new Error(`No suitable host found for url ${href}`));
  }
}
