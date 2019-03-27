# `@velcro/resolver-host-fs`

A class that implements the `ResolverHost` interface over a `require('fs')`-compatible interface.

## Usage

```js
const host = new Velcro.ResolverHostFs({
  fs: require('fs'),
});
```
