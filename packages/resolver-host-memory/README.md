# `@velcro/resolver-host-fs`

A class that implements the `ResolverHost` interface over an in-memory mock filesystem.

## Usage

```js
const host = new Velcro.ResolverHostMemory({
  'path/to/string/file': 'file contents',
  'path/to/binary/file': {
    content: 'SGVsbG8gd29ybGQK',
    encoding: 'base64',
  },
});
```
