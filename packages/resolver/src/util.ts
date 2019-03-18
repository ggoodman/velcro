import { Decoder } from '@velcro/decoder';

const CHAR_DOT = 46; /* . */
const CHAR_FORWARD_SLASH = 47; /* / */
const TRAILING_SLASH_RX = /\/?$/;

export function ensureTrailingSlash(pathname: string): string {
  return pathname.replace(TRAILING_SLASH_RX, '/');
}

export function parseBufferAsPackageJson(decoder: Decoder, content: ArrayBuffer, spec: string): PackageJson {
  try {
    const text = decoder.decode(content);

    return parseTextAsPackageJson(text, spec);
  } catch (err) {
    throw new Error(`Error decoding manifest buffer for package ${spec}: ${err.message}`);
  }
}

function parseTextAsPackageJson(text: string, spec: string): PackageJson {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
  }

  if (!isValidPackageJson(json)) {
    throw new Error(`Invalid manifest for the package ${spec}`);
  }

  return json;
}

export type PackageJson = {
  browser?: string | { [key: string]: false | string };
  main?: string;
  module?: string;
  'jsnext:main'?: string;
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
  peerDependencies?: { [key: string]: string };
};
function isValidPackageJson(json: unknown): json is PackageJson {
  return (
    json &&
    typeof json === 'object' &&
    json !== null &&
    !hasInvalidBrowserField(json as any) &&
    !hasInvalidOptionalStringField(json as any, 'main') &&
    !hasInvalidOptionalStringField(json as any, 'module') &&
    !hasInvalidOptionalStringField(json as any, 'jsnext:main') &&
    !hasInvalidDependenciesField(json as any, 'dependencies') &&
    !hasInvalidDependenciesField(json as any, 'devDependencies') &&
    !hasInvalidDependenciesField(json as any, 'peerDependencies')
  );
}

function hasInvalidBrowserField(json: any) {
  let error = '';

  const browser = json.browser;
  if (browser) {
    if (typeof browser === 'object') {
      for (const key in browser) {
        if (typeof key !== 'string') {
          error = `The key ${key} of .browser must be a string`;
          break;
        }
        if (typeof browser[key] !== 'string' && browser[key] !== false) {
          error = `The value ${key} of .browser must be a string or false`;
          break;
        }
      }
    }
  }

  return error;
}

function hasInvalidOptionalStringField(json: any, field: string) {
  return json[field] !== undefined && typeof json[field] !== 'string';
}

function hasInvalidDependenciesField(json: any, field: string) {
  return (
    json[field] !== undefined &&
    typeof json[field] === 'object' &&
    json[field] !== null &&
    !Object.keys(json[field]).every(key => typeof key === 'string' && typeof json[field][key] === 'string')
  );
}

export function getFirstPathSegmentAfterPrefix(child: URL, parent: URL): string {
  const childHref = child.pathname;
  const parentHref = parent.pathname;
  const parentOffset = parentHref.charAt(parentHref.length - 1) === '/' ? -1 : 0;

  for (let i = 0; i <= childHref.length; i++) {
    if (i < parentHref.length) {
      if (childHref.charAt(i) !== parentHref.charAt(i)) {
        throw new Error(`The child entry ${child.href} does not have the pathname of ${parent.href} as a prefix`);
      }
    } else if (i === parentHref.length + parentOffset) {
      if (childHref.charAt(i) !== '/') {
        throw new Error(`The child entry ${child.href} does not have the pathname of ${parent.href} as a prefix`);
      }
    } else if (childHref.charAt(i) === '/') {
      return childHref.slice(parentHref.length + 1 + parentOffset, i);
    }
  }

  return childHref.slice(parentHref.length + 1 + parentOffset);
}

function validateString(value: string, name: string) {
  if (typeof value !== 'string') {
    throw new TypeError(`The '${name}' argument must be of type string but got ${typeof value}`);
  }
}

export function basename(path: string, ext?: string): string {
  if (ext !== undefined) {
    validateString(ext, 'ext');
  }
  validateString(path, 'path');
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  let i;

  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path) {
      return '';
    }
    let extIdx = ext.length - 1;
    let firstNonSlashEnd = -1;
    for (i = path.length - 1; i >= start; --i) {
      const code = path.charCodeAt(i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          // We saw the first non-path separator, remember this index in case
          // we need it if the extension ends up not matching
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          // Try to match the explicit extension
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              // We matched the extension, so mark this as the end of our path
              // component
              end = i;
            }
          } else {
            // Extension does not match, so our result is the entire path
            // component
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) {
      end = firstNonSlashEnd;
    } else if (end === -1) {
      end = path.length;
    }
    return path.slice(start, end);
  } else {
    for (i = path.length - 1; i >= start; --i) {
      if (isPathSeparator(path.charCodeAt(i))) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1) {
      return '';
    }
    return path.slice(start, end);
  }
}

export function extname(path: string): string {
  validateString(path, 'path');
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;

  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return '';
  }
  return path.slice(startDot, end);
}

export function dirname(path: string) {
  validateString(path, 'path');
  const len = path.length;
  if (len === 0) {
    return '.';
  }
  let rootEnd = -1;
  let end = -1;
  let matchedSlash = true;
  let offset = 0;
  const code = path.charCodeAt(0);

  // Try to match a root
  if (len > 1) {
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = offset = 1;

      if (isPathSeparator(path.charCodeAt(1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) {
            break;
          }
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) {
              break;
            }
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) {
                break;
              }
            }
            if (j === len) {
              // We matched a UNC root only
              return path;
            }
            if (j !== last) {
              // We matched a UNC root with leftovers

              // Offset by 1 to include the separator after the UNC root to
              // treat it as a "normal root" on top of a (UNC) root
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    }
  } else if (isPathSeparator(code)) {
    // `path` contains just a path separator, exit early to avoid
    // unnecessary work
    return path;
  }

  for (let i = len - 1; i >= offset; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }

  if (end === -1) {
    if (rootEnd === -1) {
      return '.';
    } else {
      end = rootEnd;
    }
  }
  return path.slice(0, end);
}

export function join(initialSegment: string, ...pathSegments: string[]): string {
  let pathname = initialSegment;

  for (let i = 0; i < pathSegments.length; i++) {
    let segment = pathSegments[i];

    if (segment.startsWith('/')) {
      segment = segment.slice(1);
    }

    if (pathname.endsWith('/')) {
      pathname += segment;
    } else {
      pathname += `/${segment}`;
    }
  }

  return pathname;
}

export function resolve(...pathSegments: string[]): string {
  let resolvedPath = '';
  let resolvedAbsolute = false;

  for (let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let path;
    if (i >= 0) {
      path = pathSegments[i];
    } else {
      break;
    }

    validateString(path, 'path');

    // Skip empty entries
    if (path.length === 0) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, '/', isPathSeparator);

  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) {
      return '/' + resolvedPath;
    } else {
      return '/';
    }
  } else if (resolvedPath.length > 0) {
    return resolvedPath;
  } else {
    return '.';
  }
}

function isPathSeparator(code: any) {
  return code === CHAR_FORWARD_SLASH;
}

function normalizeString(
  path: string,
  allowAboveRoot: boolean,
  separator: string,
  isPathSeparator: (char: number) => boolean
) {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = -1;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSeparator(code)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== CHAR_DOT ||
          res.charCodeAt(res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = '';
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) {
            res += `${separator}..`;
          } else {
            res = '..';
          }
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += separator + path.slice(lastSlash + 1, i);
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}
