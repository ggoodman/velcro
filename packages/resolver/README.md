# `@velcro/resolver`

A tool for resolving require paths to the canonical url of the asset using a generic `ResolverHost` interface.

## Usage

```js
// host is an implementation of the ResolverHost interface
const resolver = new Velcro.Resolver(host, {
  packageMain: ['browser', 'main'],
  extensions: ['.js', '.json'],
});

const url = await resolver.resolve('https://unpkg.com/react@16');
// --> https://unpkg.com/react@16.8.5/index.js
```
