/** @type {import('../../packages/runtime/src')} */
const Velcro = window.Velcro;

/**
 * An ResolverHost implementation that holds a set of files in an in-memory structure
 */
class ResolverHostMemory extends Velcro.ResolverHost {
  constructor(files) {
    super();

    this.root = {
      type: 'directory',
      children: {},
    };

    this.textEncoder = new TextEncoder();

    for (const pathname in files) {
      this.addFile(pathname, files[pathname]);
    }
  }

  getEntryAtPath(pathname) {
    const segments = Array.isArray(pathname) ? pathname.slice() : pathname.split('/').filter(Boolean);

    let parent = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== 'directory') {
        throw new Error(`Failed to add ${pathname}`);
      }

      parent = parent.children[segment];
    }

    return parent;
  }

  addFile(pathname, content = '') {
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments.pop();

    if (!filename) {
      throw new Error(`Unable to add a file without a filename '${pathname}'`);
    }

    let parent = this.root;

    for (const segment of segments) {
      if (!parent || parent.type !== 'directory') {
        throw new Error(`Failed to add ${pathname}`);
      }

      let dir = parent.children[segment];

      if (!dir) {
        dir = {
          type: 'directory',
          children: {},
        };

        parent.children[segment] = dir;
      }

      parent = dir;
    }

    if (parent.type !== 'directory') {
      throw new Error(`Cannot add file to a non directory entry ${pathname}`);
    }

    if (parent.children[filename]) {
      throw new Error(`Entry already exists at ${pathname}`);
    }

    const entry = {
      type: 'file',
      content,
    };

    parent.children[filename] = entry;

    return entry;
  }

  getResolveRoot(resolver, url) {
    return Promise.resolve(new URL(`file:///`));
  }

  listEntries(resolver, url) {
    const parent = this.getEntryAtPath(url.pathname);

    if (!parent) {
      return;
    }

    if (parent.type !== 'directory') {
      throw new Error(`Cannot list entries under a file at ${url.href}`);
    }

    return Promise.resolve(
      Object.keys(parent.children).map(filename => {
        const entry = parent.children[filename];

        return {
          url: new URL(Velcro.util.join(url.pathname, filename), url),
          type: entry.type,
        };
      })
    );
  }

  readFileContent(resolver, url) {
    const entry = this.getEntryAtPath(url.pathname);

    if (!entry) {
      return;
    }

    if (entry.type !== 'file') {
      throw new Error(`Cannot read content of a non-file at ${url.href}`);
    }

    return Promise.resolve(this.textEncoder.encode(entry.content).buffer);
  }
}

/**
 * @returns {Promise<ReturnType<import('../../packages/runtime/src').createRuntime>>}
 */
async function main() {
  const cacheStats = {
    hits: 0,
    misses: 0,
  };
  // Create an object implementing the cache interface. This cache is designed to keep
  // stats and ignore anything from a `file:///` url.
  const cache = {
    get(segment, id) {
      const key = `${segment}:${id}`;
      const result = localStorage.getItem(key);

      if (result) {
        cacheStats.hits++;
        return JSON.parse(result);
      }
      cacheStats.misses++;
    },
    set(segment, id, value) {
      if (id.startsWith('file:///')) {
        // Don't cache anything on the virtual file:/// system
        return;
      }

      const key = `${segment}:${id}`;
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
  // The initial set of files in the virtual file:/// system. We create a simple index.js file
  // that exports a function that will render a react component to `#root`. The virtual filesystem
  // also holds a simple `package.json` that describes which version of react to use.
  const initialFiles = {
    'index.js': `
'use strict';

const React = require('react');
const ReactDom = require('react-dom');

module.exports = (importStart, importEnd, cacheStats) =>
ReactDom.render(
  React.createElement(
    'span',
    null,
    \`Imported in \${importEnd - importStart}ms with \${(100 * cacheStats.hits) /
      (cacheStats.hits + cacheStats.misses)}% cache hit rate (\${cacheStats.hits} hits, \${cacheStats.misses} misses)\`
  ),
  document.getElementById('root')
);
    `.trim(),
    'package.json': JSON.stringify(
      {
        name: 'compound-host-with-cache',
        dependencies: {
          react: '^16.8.6',
          'react-dom': '^16.8.6',
        },
      },
      null,
      2
    ),
  };
  const resolverHost = new Velcro.ResolverHostCompound({
    'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
    'file:///': new ResolverHostMemory(initialFiles),
  });
  const runtime = Velcro.createRuntime({
    cache,
    injectGlobal: Velcro.injectGlobalFromUnpkg,
    resolveBareModule: Velcro.resolveBareModuleToUnpkg,
    resolverHost,
  });

  const importStart = Date.now();
  const render = await runtime.import('file:///index.js');
  const importEnd = Date.now();

  // Now let's call the exported render function with the stats
  render(importStart, importEnd, cacheStats);

  return;
}

main().catch(console.error);
