# `@velcro/resolver-host-unpkg`

A class that implements the `ResolverHost` interface over the [unpkg.com](https://unpkg.com) CDN. This host does not rely on unpkg's own automatic main file resolution and so it will respect the parent `Resolver`'s configuration.

## Usage

```js
const host = new Velcro.ResolverHostUnpkg({
  fetch, // Optional reference to a `fetch` implementation
});
```
