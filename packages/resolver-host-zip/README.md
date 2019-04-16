# `@velcro/resolver-host-zip`

A class that implements the `ResolverHost` interface over a zip file. The zip file can be loaded asynchronously, supporting zip files hosted at urls, for example.

## Usage

```js
const host = new Velcro.ResolverHostZip({
  zipFile() => fetch('https://github.com/ggoodman/velcro/archive/master.zip').then(res => res.blob());
});
```
