import { URI } from 'ts-primitives';

const TRAILING_SLASH_RX = /\/?$/;

export class Uri extends URI {
  static ensureTrailingSlash(uri: Uri, trailingSlash = '/') {
    return uri.with({
      path: uri.path.replace(TRAILING_SLASH_RX, trailingSlash),
    });
  }

  static equals(l: Uri, r: Uri) {
    return (
      l.authority === r.authority &&
      l.fragment === r.fragment &&
      l.path === r.path &&
      l.query === r.query &&
      l.scheme === r.scheme
    );
  }

  static getFirstPathSegmentAfterPrefix(child: Uri, parent: Uri): string {
    const childHref = child.path;
    const parentHref = parent.path;
    const parentOffset = parentHref.charAt(parentHref.length - 1) === '/' ? -1 : 0;

    for (let i = 0; i <= childHref.length; i++) {
      if (i < parentHref.length) {
        if (childHref.charAt(i) !== parentHref.charAt(i)) {
          throw new Error(
            `The child entry ${child.toString()} does not have the pathname of ${parent.toString()} as a prefix`
          );
        }
      } else if (i === parentHref.length + parentOffset) {
        if (childHref.charAt(i) !== '/') {
          throw new Error(
            `The child entry ${child.toString()} does not have the pathname of ${parent.toString()} as a prefix`
          );
        }
      } else if (childHref.charAt(i) === '/') {
        return childHref.slice(parentHref.length + 1 + parentOffset, i);
      }
    }

    return childHref.slice(parentHref.length + 1 + parentOffset);
  }

  static from(...args: Parameters<typeof URI['from']>) {
    return new Uri(super.from(...args));
  }

  static joinPath(...args: Parameters<typeof URI['joinPath']>) {
    return new Uri(super.joinPath(...args));
  }

  static isPrefixOf(prefix: Uri, uri: Uri) {
    return (
      prefix.authority === uri.authority &&
      prefix.fragment === uri.fragment &&
      prefix.query === uri.query &&
      prefix.scheme === uri.scheme &&
      uri.path.startsWith(prefix.path)
    );
  }

  static parse(...args: Parameters<typeof URI['parse']>) {
    return new Uri(super.parse(...args));
  }

  static revive(...args: Parameters<typeof URI['revive']>) {
    //@ts-ignore
    return new Uri(super.revive(...args));
  }

  toString(skipEncoding = true) {
    return super.toString(skipEncoding);
  }

  with(...args: Parameters<URI['with']>) {
    return new Uri(super.with(...args));
  }
}
