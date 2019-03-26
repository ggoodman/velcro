# Velcro

Velcro is a suite of packages designed to bridge the runtime gap between browser development and the node package ecosystem.

The CommonJS module system used by node.js and bundlers like Webpack presents serious challenges for anyone looking to build tooling. Consider the code`require('./path')`; to determine the canonical path of this asset, you need to respect the [Node Module Resolution Algorithm](https://nodejs.org/api/modules.html#modules_all_together). Further, since you might be running this in the browser, you may want to respect the [Package Browser Field Spec](https://github.com/defunctzombie/package-browser-field-spec). Of course, there are modules like [resolve](https://www.npmjs.com/package/resolve) that do this for you (and quite nicely, I might add), these always force trade-offs like: loss of support for the `browser` spec, or a hard dependency on node's built-in `fs` module. What about the wackiness of nested `package.json` files and the million other edge cases?

Velcro defines a generic `ResolverHost` interface that exposes the minimal set of operations required to perform node module resolution across a wide variety of hosts (like [unpkg.com](https://unpkg.com) or [BrowserFs](https://www.npmjs.com/package/browserfs)). Further, the interface is designed such that these hosts can be composed in different ways to provide things like:

- Caching
- Composition (different prefixes relate to differet child hosts)
- Logging

The `ResolverHost` interface looks like this:

```ts
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
```

With a generic `Resolver` that is able to resolve assets from many different 'hosts', we can build extra layers of tooling.

For example, we could build a `Runtime` built on a fork of [SystemJS](https://github.com/systemjs/systemjs) that uses something like [acorn](https://github.com/acornjs/acorn) to parse javascript assets. We can traverse the dependency graph and even skip those branches that are guarded by the value of `process.env.NODE_ENV`, resolving each dependency we discover using the `Resolver. Our`SystemJS` runtime, can schedule the execution of these assets so that the semantics of CommonJS are respected.

Now imagine what it would look like if we took this system and provided a mechanism to run certain assets through [Webpack Loaders](https://webpack.js.org/loaders/). These loaders could be resolved and imported dynamically using the runtime we're describing so consumers only get what they need, when they need it. Throw in a layer of caching and the system becomes performant.

You now have a generic runtime that can execute code from _any source_ in the context of the full catalogue of npm modules\*, **without any build step**.

This is Velcro. Enjoy.

> - There will be exceptions, like modules having binary dependencies or dependencies on node core modules and behaviour for which there are no adequate browser equivalents.

## Components

### `@velcro/resolver`

A tool for resolving require paths to the canonical url of the asset using a generic `ResolverHost` interface.

```js
// host is an implementation of the ResolverHost interface
const resolver = new Velcro.Resolver(host, {
  packageMain: ['browser', 'main'],
  extensions: ['.js', '.json'],
});

const url = await resolver.resolve('https://unpkg.com/react@16');
// --> https://unpkg.com/react@16.8.5/index.js
```

#### Features

- Respects the semantics of the `browser` field and supports both the object syntax and string syntax to add resolution overlays.

### `@velcro/resolver-host-unpkg`

A class that implements the `ResolverHost` interface over the [unpkg.com](https://unpkg.com) CDN. This host does not rely on unpkg's own automatic main file resolution and so it will respect the parent `Resolver`'s configuration.

```js
const host = new Velcro.ResolverHostUnpkg({
  fetch, // Optional reference to a `fetch` implementation
});
```

### `@velcro/runtime`

A pre-packaged runtime designed to resolve, transform and execute code in the context of a `Resolver`.

```js
const runtime = Velcro.createRuntime();

const React = await runtime.import('react@16');
// --> { createElement, Component, ...}
```

#### Features

- Traverses the AST of javascript assets to inject browser shims for node globals and node built-in modules.
- Skips AST branches based on `process.env.NODE_ENV` to respect idiomatic ways of shipping production and development builds.
- Support for running css assets through `css-loader` and `style-loader` webpack loaders and includes the plumbing to support other, arbitrary loaders.

## Planned

The vision for the Velcro ecosystem includes additional `ResolverHost` implementations that would:

- Allow for _compound_ `ResolverHosts` that delegate resolutions for specific prefixes to different child `ResolverHost` instances.
- Allow for caching of runtime artifacts to an abstract cache so that artifacts could be stored in, and retrieved from, something like IndexedDB.
- Build a `ResolverHostFs` that implements the `ResolverHost` interface over an `fs`-compatible object to support things like `BrowserFs` or node's built-in `fs`.
