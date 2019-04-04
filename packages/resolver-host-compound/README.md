# `@velcro/resolver-host-compound`

A class that implements the `ResolverHost` interface over a set of child `ResolverHost`s that each map to a distinct prefix.

## Usage

```js
const host = new Velcro.ResolverHostCompound({
  'https://unpkg.com/': new Velcro.ResolverHostUnpkg(),
  'file:///': new Velcro.ResolverHostFs({ fs }),
});
```
