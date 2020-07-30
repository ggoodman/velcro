'use strict';
/**
 * Emulates Node's `path` module. This module contains utilities for handling and
 * transforming file paths. **All** of these methods perform only string
 * transformations. The file system is not consulted to check whether paths are
 * valid.
 * @see http://nodejs.org/api/path.html
 */
// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^/]+?|)(\.[^./]*|))(?:[/]*)$/;
function posixSplitPath(filename) {
  var out = splitPathRe.exec(filename);
  out.shift();
  return out;
}
/**
 * Normalize a string path, taking care of '..' and '.' parts.
 *
 * When multiple slashes are found, they're replaced by a single one; when the path contains a trailing slash, it is preserved. On Windows backslashes are used.
 * @example Usage example
 *   path.normalize('/foo/bar//baz/asdf/quux/..')
 *   // returns
 *   '/foo/bar/baz/asdf'
 * @param [String] p The path to normalize.
 * @return [String]
 */
function normalize(p) {
  // Special case: '' -> '.'
  if (p === '') {
    p = '.';
  }
  // It's very important to know if the path is relative or not, since it
  // changes how we process .. and reconstruct the split string.
  var absolute = p.charAt(0) === exports.sep;
  // Remove repeated //s
  p = _removeDuplicateSeps(p);
  // Try to remove as many '../' as possible, and remove '.' completely.
  var components = p.split(exports.sep);
  var goodComponents = [];
  for (var idx = 0; idx < components.length; idx++) {
    var c = components[idx];
    if (c === '.') {
      continue;
    } else if (c === '..' && (absolute || (!absolute && goodComponents.length > 0 && goodComponents[0] !== '..'))) {
      // In the absolute case: Path is relative to root, so we may pop even if
      // goodComponents is empty (e.g. /../ => /)
      // In the relative case: We're getting rid of a directory that preceded
      // it (e.g. /foo/../bar -> /bar)
      goodComponents.pop();
    } else {
      goodComponents.push(c);
    }
  }
  // Add in '.' when it's a relative path with no other nonempty components.
  // Possible results: '.' and './' (input: [''] or [])
  // @todo Can probably simplify this logic.
  if (!absolute && goodComponents.length < 2) {
    switch (goodComponents.length) {
      case 1:
        if (goodComponents[0] === '') {
          goodComponents.unshift('.');
        }
        break;
      default:
        goodComponents.push('.');
    }
  }
  p = goodComponents.join(exports.sep);
  if (absolute && p.charAt(0) !== exports.sep) {
    p = exports.sep + p;
  }
  return p;
}
exports.normalize = normalize;
/**
 * Join all arguments together and normalize the resulting path.
 *
 * Arguments must be strings.
 * @example Usage
 *   path.join('/foo', 'bar', 'baz/asdf', 'quux', '..')
 *   // returns
 *   '/foo/bar/baz/asdf'
 *
 *   path.join('foo', {}, 'bar')
 *   // throws exception
 *   TypeError: Arguments to path.join must be strings
 * @param [String,...] paths Each component of the path
 * @return [String]
 */
function join() {
  var paths = [];
  for (var _i = 0; _i < arguments.length; _i++) {
    paths[_i] = arguments[_i];
  }
  // Required: Prune any non-strings from the path. I also prune empty segments
  // so we can do a simple join of the array.
  var processed = [];
  for (var i = 0; i < paths.length; i++) {
    var segment = paths[i];
    if (typeof segment !== 'string') {
      throw new TypeError('Invalid argument type to path.join: ' + typeof segment);
    } else if (segment !== '') {
      processed.push(segment);
    }
  }
  return normalize(processed.join(exports.sep));
}
exports.join = join;
/**
 * Resolves to to an absolute path.
 *
 * If to isn't already absolute from arguments are prepended in right to left
 * order, until an absolute path is found. If after using all from paths still
 * no absolute path is found, the current working directory is used as well.
 * The resulting path is normalized, and trailing slashes are removed unless
 * the path gets resolved to the root directory. Non-string arguments are
 * ignored.
 *
 * Another way to think of it is as a sequence of cd commands in a shell.
 *
 *     path.resolve('foo/bar', '/tmp/file/', '..', 'a/../subfile')
 *
 * Is similar to:
 *
 *     cd foo/bar
 *     cd /tmp/file/
 *     cd ..
 *     cd a/../subfile
 *     pwd
 *
 * The difference is that the different paths don't need to exist and may also
 * be files.
 * @example Usage example
 *   path.resolve('/foo/bar', './baz')
 *   // returns
 *   '/foo/bar/baz'
 *
 *   path.resolve('/foo/bar', '/tmp/file/')
 *   // returns
 *   '/tmp/file'
 *
 *   path.resolve('wwwroot', 'static_files/png/', '../gif/image.gif')
 *   // if currently in /home/myself/node, it returns
 *   '/home/myself/node/wwwroot/static_files/gif/image.gif'
 * @param [String,...] paths
 * @return [String]
 */
function resolve() {
  var paths = [];
  for (var _i = 0; _i < arguments.length; _i++) {
    paths[_i] = arguments[_i];
  }
  // Monitor for invalid paths, throw out empty paths, and look for the *last*
  // absolute path that we see.
  var processed = [];
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    if (typeof p !== 'string') {
      throw new TypeError('Invalid argument type to path.join: ' + typeof p);
    } else if (p !== '') {
      // Remove anything that has occurred before this absolute path, as it
      // doesn't matter.
      if (p.charAt(0) === exports.sep) {
        processed = [];
      }
      processed.push(p);
    }
  }
  // Special: Remove trailing slash unless it's the root
  var resolved = normalize(processed.join(exports.sep));
  if (resolved.length > 1 && resolved.charAt(resolved.length - 1) === exports.sep) {
    return resolved.substr(0, resolved.length - 1);
  }
  // Special: If it doesn't start with '/', it's relative and we need to append
  // the current directory.
  if (resolved.charAt(0) !== exports.sep) {
    // Remove ./, since we're going to append the current directory.
    if (resolved.charAt(0) === '.' && (resolved.length === 1 || resolved.charAt(1) === exports.sep)) {
      resolved = resolved.length === 1 ? '' : resolved.substr(2);
    }
    // Append the current directory, which *must* be an absolute path.
    var cwd = process.cwd();
    if (resolved !== '') {
      // cwd will never end in a /... unless it's the root.
      resolved = normalize(cwd + (cwd !== '/' ? exports.sep : '') + resolved);
    } else {
      resolved = cwd;
    }
  }
  return resolved;
}
exports.resolve = resolve;
/**
 * Solve the relative path from from to to.
 *
 * At times we have two absolute paths, and we need to derive the relative path
 * from one to the other. This is actually the reverse transform of
 * path.resolve, which means we see that:
 *
 *    path.resolve(from, path.relative(from, to)) == path.resolve(to)
 *
 * @example Usage example
 *   path.relative('C:\\orandea\\test\\aaa', 'C:\\orandea\\impl\\bbb')
 *   // returns
 *   '..\\..\\impl\\bbb'
 *
 *   path.relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb')
 *   // returns
 *   '../../impl/bbb'
 * @param [String] from
 * @param [String] to
 * @return [String]
 */
function relative(from, to) {
  var i;
  // Alright. Let's resolve these two to absolute paths and remove any
  // weirdness.
  from = resolve(from);
  to = resolve(to);
  var fromSegs = from.split(exports.sep);
  var toSegs = to.split(exports.sep);
  // Remove the first segment on both, as it's '' (both are absolute paths)
  toSegs.shift();
  fromSegs.shift();
  // There are two segments to this path:
  // * Going *up* the directory hierarchy with '..'
  // * Going *down* the directory hierarchy with foo/baz/bat.
  var upCount = 0;
  var downSegs = [];
  // Figure out how many things in 'from' are shared with 'to'.
  for (i = 0; i < fromSegs.length; i++) {
    var seg = fromSegs[i];
    if (seg === toSegs[i]) {
      continue;
    }
    // The rest of 'from', including the current element, indicates how many
    // directories we need to go up.
    upCount = fromSegs.length - i;
    break;
  }
  // The rest of 'to' indicates where we need to change to. We place this
  // outside of the loop, as toSegs.length may be greater than fromSegs.length.
  downSegs = toSegs.slice(i);
  // Special case: If 'from' is '/'
  if (fromSegs.length === 1 && fromSegs[0] === '') {
    upCount = 0;
  }
  // upCount can't be greater than the number of fromSegs
  // (cd .. from / is still /)
  if (upCount > fromSegs.length) {
    upCount = fromSegs.length;
  }
  // Create the final string!
  var rv = '';
  for (i = 0; i < upCount; i++) {
    rv += '../';
  }
  rv += downSegs.join(exports.sep);
  // Special case: Remove trailing '/'. Happens if it's all up and no down.
  if (rv.length > 1 && rv.charAt(rv.length - 1) === exports.sep) {
    rv = rv.substr(0, rv.length - 1);
  }
  return rv;
}
exports.relative = relative;
/**
 * Return the directory name of a path. Similar to the Unix `dirname` command.
 *
 * Note that BrowserFS does not validate if the path is actually a valid
 * directory.
 * @example Usage example
 *   path.dirname('/foo/bar/baz/asdf/quux')
 *   // returns
 *   '/foo/bar/baz/asdf'
 * @param [String] p The path to get the directory name of.
 * @return [String]
 */
function dirname(p) {
  // We get rid of //, but we don't modify anything else (e.g. any extraneous .
  // and ../ are kept intact)
  p = _removeDuplicateSeps(p);
  var absolute = p.charAt(0) === exports.sep;
  var sections = p.split(exports.sep);
  // Do 1 if it's /foo/bar, 2 if it's /foo/bar/
  if (sections.pop() === '' && sections.length > 0) {
    sections.pop();
  }
  // # of sections needs to be > 1 if absolute, since the first section is '' for '/'.
  // If not absolute, the first section is the first part of the path, and is OK
  // to return.
  if (sections.length > 1 || (sections.length === 1 && !absolute)) {
    return sections.join(exports.sep);
  } else if (absolute) {
    return exports.sep;
  } else {
    return '.';
  }
}
exports.dirname = dirname;
/**
 * Return the last portion of a path. Similar to the Unix basename command.
 * @example Usage example
 *   path.basename('/foo/bar/baz/asdf/quux.html')
 *   // returns
 *   'quux.html'
 *
 *   path.basename('/foo/bar/baz/asdf/quux.html', '.html')
 *   // returns
 *   'quux'
 * @param [String] p
 * @param [String?] ext
 * @return [String]
 */
function basename(p, ext) {
  if (ext === void 0) {
    ext = '';
  }
  // Special case: Normalize will modify this to '.'
  if (p === '') {
    return p;
  }
  // Normalize the string first to remove any weirdness.
  p = normalize(p);
  // Get the last part of the string.
  var sections = p.split(exports.sep);
  var lastPart = sections[sections.length - 1];
  // Special case: If it's empty, then we have a string like so: foo/
  // Meaning, 'foo' is guaranteed to be a directory.
  if (lastPart === '' && sections.length > 1) {
    return sections[sections.length - 2];
  }
  // Remove the extension, if need be.
  if (ext.length > 0) {
    var lastPartExt = lastPart.substr(lastPart.length - ext.length);
    if (lastPartExt === ext) {
      return lastPart.substr(0, lastPart.length - ext.length);
    }
  }
  return lastPart;
}
exports.basename = basename;
/**
 * Return the extension of the path, from the last '.' to end of string in the
 * last portion of the path. If there is no '.' in the last portion of the path
 * or the first character of it is '.', then it returns an empty string.
 * @example Usage example
 *   path.extname('index.html')
 *   // returns
 *   '.html'
 *
 *   path.extname('index.')
 *   // returns
 *   '.'
 *
 *   path.extname('index')
 *   // returns
 *   ''
 * @param [String] p
 * @return [String]
 */
function extname(p) {
  p = normalize(p);
  var sections = p.split(exports.sep);
  p = sections.pop();
  // Special case: foo/file.ext/ should return '.ext'
  if (p === '' && sections.length > 0) {
    p = sections.pop();
  }
  if (p === '..') {
    return '';
  }
  var i = p.lastIndexOf('.');
  if (i === -1 || i === 0) {
    return '';
  }
  return p.substr(i);
}
exports.extname = extname;
/**
 * Checks if the given path is an absolute path.
 *
 * Despite not being documented, this is a tested part of Node's path API.
 * @param [String] p
 * @return [Boolean] True if the path appears to be an absolute path.
 */
function isAbsolute(p) {
  return p.length > 0 && p.charAt(0) === exports.sep;
}
exports.isAbsolute = isAbsolute;
/**
 * Unknown. Undocumented.
 */
function _makeLong(p) {
  return p;
}
exports._makeLong = _makeLong;
/**
 * Returns an object from a path string.
 */
function parse(p) {
  var allParts = posixSplitPath(p);
  return {
    root: allParts[0],
    dir: allParts[0] + allParts[1].slice(0, -1),
    base: allParts[2],
    ext: allParts[3],
    name: allParts[2].slice(0, allParts[2].length - allParts[3].length),
  };
}
exports.parse = parse;
function format(pathObject) {
  if (pathObject === null || typeof pathObject !== 'object') {
    throw new TypeError("Parameter 'pathObject' must be an object, not " + typeof pathObject);
  }
  var root = pathObject.root || '';
  if (typeof root !== 'string') {
    throw new TypeError("'pathObject.root' must be a string or undefined, not " + typeof pathObject.root);
  }
  var dir = pathObject.dir ? pathObject.dir + exports.sep : '';
  var base = pathObject.base || '';
  return dir + base;
}
exports.format = format;
// The platform-specific file separator. BrowserFS uses `/`.
exports.sep = '/';
exports._replaceRegex = /(^|[^:])\/\/+/g;
function _removeDuplicateSeps(p) {
  p = p.replace(exports._replaceRegex, `$1${exports.sep}`);
  return p;
}
exports._removeDuplicateSeps = _removeDuplicateSeps;
// The platform-specific path delimiter. BrowserFS uses `:`.
exports.delimiter = ':';
