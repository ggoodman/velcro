# `@velcro/runtime`

A pre-packaged runtime designed to resolve, transform and execute code in the context of a `Resolver`.

## Usage

```js
const runtime = Velcro.createRuntime();

const React = await runtime.import('react@16');
// --> { createElement, Component, ...}
```

## Features

- Traverses the AST of javascript assets to inject browser shims for node globals and node built-in modules.
- Skips AST branches based on `process.env.NODE_ENV` to respect idiomatic ways of shipping production and development builds.
- Support for running css assets through `css-loader` and `style-loader` webpack loaders and includes the plumbing to support other, arbitrary loaders.
