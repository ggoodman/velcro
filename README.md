# Velcro

Velcro is a suite of packages designed to allow resolving modules in any JavaScript context, from any source. Velcro provides to tools to build a graph of these modules and then flatten this graph into bundles or executable code.

## ✅ Why you might be interested in Velcro

Beyond beeing intrinsically interesting for the challenges it faces and the approaches taken to address these, there are a number of reasons why you might be interested in Velcro.

1. You would like to run code in the browser but you can't predict the structure, or dependencies of that code. Velcro can help combine dynamic code with NPM modules coming from a CDN like [unpkg.com](https://unpkg.com) or [jsDelivr.com](https://jsdelivr.com).
2. You would like to bundle some code with NPM dependencies but do not have access to a filesystem or do not want to run `npm install`.
3. You would like to resolve modules and read their content from a CDN like [unpkg.com](https://unpkg.com) or [jsDelivr.com](https://jsdelivr.com) in a way that respects the [Node Module Resolution Algorithm](https://nodejs.org/api/modules.html#modules_all_together). This might be interesting if, for example, you wanted to load TypeScript definition files to seed something like the [monaco-editor](https://github.com/microsoft/monaco-editor).
4. You want to build tooling that requires access to a module dependency graph. For example, you might want to show the set of _files_ in a dependency graph and their inter-dependencies.

## 🗺 Velcro module resolution

Velcro starts from the principle that we cannot assume anything about the environment in which it runs (beyond that it has some baseline JavaScript primitives). Given this assumption, it follows that we cannot rely on having access to tools like [npm](https://npm.im/npm) or even a [filesystem](https://nodejs.org/api/fs.html).

Without a file system, Velcro takes the stance that all source modules (files) should be addressable by a _canonical_ url. In a world where modules are identified by urls, Velcro can allow situations where some files come from an in-memory `memory:///index.js` scheme, others from the filesystem at `file:///index.js` and yet others can come from a CDN like unpkg.com at `https://unpkg.com/react@16.13.1/index.js`.

Typically, the transition from one url scheme to another happens at the 'bare module' boundary. A bare module boundary is when one module expresses a dependency on something that is neither a relative nor absolute path. In Velcro, for example, a common pattern is to use the [`CompoundStrategy`](./packages/@velcro/strategy-compound) to join the [`CdnStrategy`](./packages/@velcro/strategy-cdn) to something like the [`FsStrategy`](./packages/@velcro/strategy-fs) or [`MemoryStrategy`](./packages/@velcro/strategy-memory) strategies.

Example:

```ts
const cdnStrategy = CdnStrategy.forJsDelivr(readUrlFunction);
const memoryStrategy = new MemoryStrategy({
  '/index.js': 'module.exports = require("react");',
  '/package.json': JSON.stringify({
    name: '@@velcro/execute',
    version: '0.0.0',
    dependencies: {
      react: '^16.13.0',
    },
  }),
});
const compoundStrategy = new CompoundStrategy({ strategies: [cdnStrategy, memoryStrategy] });
```

As you can see, Velcro relies heavily on implementations of the [`ResolverStrategy`](#resolver_strategy) interface to perform its functions. The design of the `ResolverStrategy` interface is such that it should be easy to compose.

You may, for example, write a caching strategy that sits behind a compound strategy but in front of a 'slow' strategy like a CDN. This caching strategy would be able to serve cache hits from cache and delegate misses to the child, CDN strategy.

Different resolver strategies can be composed together so that the final, top-level strategy that you pass to the `Resolver` has the exact behaviour you are looking for.

## 🕸 Dependency graph

Since we have something that can resolve modules and read their code, from any source, and from any JavaScript runtime, we have all the tools we need to build build out a graph of modules.

Velcro's [@velcro/bundler](./packages/@velcro/bundler) package does exactly that. It takes some configuration settings and a `Resolver` that has been instantiated with a `ResolverStrategy` and is able to efficiently build out the dependency graph between modules.

The bundler is unusual in that since there is no `npm`, no `yarn`, no `pnpm` or any such tool it cannot rely on something else composing npm modules into a `node_modules` tree. Instead, it contains logic to parse each file to identify that file's dependencies so that the graph building can continue.

What is really interesting, is that since Velcro is a tightly-integrated system, it was build so that we can obtain a record of every file and directory that was consulted to resolve file B from file A. Each edge in the graph therefore contains a record of all logical files or directories that, if changed, would invalidate that edge. This allows Velcro's bundler to be designed to react efficiently, accurately -- and more importantly -- minimally to changes.

Similarly, if a resolver strategy was designed to _transpile_ files on the fly, that strategy could indicate to the graph builder which files were consulted to generate the transpiled output. Changes to these files would then invalidate the file's node (not the edge).

## 📦 Bundling

With a module dependency graph in hand, it is not a huge leap to be able to serialize that graph into executable form. Why not?

> **Hey! Let's build a browser-native JavaScript bundler!**

The [@velcro/bundler](./packages/@velcro/bundler) module can take a graph build using the `buildGraph()` function and split it into different logical chunks. You can provide your own heuristic for allocating files to chunks or you can let Velcro happily dump everything into a single `Chunk`.

A `Chunk` is a subset of the overall dependency graph. To serialize it, different methods are available to produce a `Build` from the chunk. A `Build` has methods to output the combined code according to the format chosen when building the chunk.

Oh, and did I forget to mention that source-maps are tracked the whole way through? _In the browser?_ OF COURSE!

The source map for a build can be produced in one of several formats via getters on the `Build` instance.

## ✨ Magic

With this sort of pattern, different components can be composed to provide higher-level, opinionated tools like the [`@velcro/runner`](./packages/@velcro/runner).

> The runner is barely distinguishable from magic.

Given some code you want to run and the npm dependencies it might have, the runner will:

1. Create a `Resolver` with a combination of the `MemoryStrategy`, the `CdnStrategy` and the `CompoundStrategy`.
2. Load the graph of modules implied by your code and its dependencies by using the `Resolver`.
3. Serialize the graph into an executable bundle an inject a `Runtime`.
4. Call the `require` method of the returned `Runtime` instance and return the exports of your code.

Let's review: the runner allows **any** code to be run **anywhere** with **no pre-existing conditions** except a 112 kB (minified) UMD bundle.

## Resolver Strategy

The resolver strategy interface represents the minimal set of operations that allow Velcro to operate efficiently across a wide variety of conceptual backends. Implementing this interface is what allows modules to be resolved across different media.

### getUrlForBareModule

> Note: Not all strategies need to implement this. In practice, at least _one_ does if you want to be able to resolve bare module specifiers like `"react"`.

```ts
interface ResolverStrategy {
  /**
   * Produce a url given the components of a bare module specifier.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param name The name of a bare module
   * @param spec The optional `@version` of a bare module specifier
   * @param path The optional path at the end of the bare module specifier
   */
  getUrlForBareModule?(
    ctx: ResolverContext,
    name: string,
    spec: string,
    path: string
  ): MaybeThenable<ResolverStrategy.BareModuleResult>;
}
```

### getCanonicalUrl

```ts
interface ResolverStrategy {
  /**
   * Determine the canonical uri for a given uri.
   *
   * For example, you might consider symlink targets their canonicalized path or you might
   * consider the canonicalized path of https://unpkg.com/react to be
   * https://unpkg.com/react@16.13.1/index.js.
   *
   * Dealing only in canonical uris means that anything produced from those can be cached.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri to canonicalize
   */
  getCanonicalUrl(
    ctx: ResolverContext,
    uri: Uri
  ): MaybeThenable<ResolverStrategy.CanonicalizeResult>;
}
```

### getResolveRoot

```ts
interface ResolverStrategy {
  /**
   * Get the logical resolve root for a given uri.
   *
   * For example, a filesystem-based strategy might consider the root to be `file:///`. Or,
   * if it was scoped to /home/filearts, the root might be `file:///home/filearts/`.
   *
   * Any uri that is not a 'child' of the resolve root should be considered out of scope for a given
   * strategy.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri for which the logical resolve root uri should be found
   */
  getResolveRoot(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.ResolveRootResult>;
}
```

### getSettings

> Note: Any strategy extending the `AbstractResolverStrategy` does not _need_ to implement this method as default behaviour is provided.

```ts
interface ResolverStrategy {
  /**
   * Get the settings for a given uri
   *
   * This indirection allows resolver strategies to have per-strategy or even per-uri settings.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri for which to load settings
   */
  getSettings(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.SettingsResult>;
}
```

### listEntries

```ts
interface ResolverStrategy {
  /**
   * Produce a list of resolved entries that are direct children of the given uri.
   *
   * This is the moral equivalent to something like non-recursive `fs.readdir()`. It is only
   * designed to show files and folders (for now).
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri at which to list entries
   */
  listEntries(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.ListEntriesResult>;
}
```

### readFileContent

```ts
interface ResolverStrategy {
  /**
   * Read the content at the uri as an `ArrayBuffer`
   *
   * ArrayBuffers are the lowest-common-denominator across the web and node and can easily be
   * decoded with standard web apis like `StringDecoder`. In Node.js, `Buffer` objects are also
   * `ArrayBuffer`s, allowing the tooling to be built on that primitive.
   *
   * This is helpful for the understanding that not all uris are expected to produce meaningful
   * text representations.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri at which to read the content
   */
  readFileContent(
    ctx: ResolverContext,
    uri: Uri
  ): MaybeThenable<ResolverStrategy.ReadFileContentResult>;
}
```

## Contributing

Velcro is organized as a monorepo with inter-module dependencies managed by [lerna](https://github.com/lerna/lerna).

**Initial setup:**

```sh
# Install top-level developement dependencies
npm install

# Bootstrap package-level dependencies and set up symlinks between packages
npx lerna bootstrap
```

**Running tests:**

Running tests currently does _not_ rely on having built packages. [Jest](https://jestjs.io) is used with [ts-jest](https://github.com/kulshekhar/ts-jest) to run unit and integration tests. Jest is set up such that each package is its own logical [project](https://jestjs.io/docs/en/configuration#projects-arraystring--projectconfig) and a further project is configured for top-level integration tests.

Jest is configured with [`moduleNameMapper`](https://jestjs.io/docs/en/configuration#modulenamemapper-objectstring-string--arraystring) settings that are designed to match the `paths` mappings in the `tsconfig.json` file.

Tests can be run via the `test` package script:

```sh
npm run test
```

**Building:**

Building velcro is also orchestrated by `lerna` and the actual building is done by [Rollup](https://rollupjs.org).

```sh
npm run build
```
