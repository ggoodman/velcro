# nostalgie

![npm (scoped)](https://img.shields.io/npm/v/nostalgie?style=flat-square)
![NPM](https://img.shields.io/npm/l/nostalgie?style=flat-square)

A reminder of what the web once was - your hopes and dreams and a single html file.

_Nostalgie_ means nostalgia in French. This library is an ode to a simpler time; a time when the code you wrote was the code that ran and the biggest source of complexity was finding the modules you wanted on a suitable CDN.

The goal of this project is to let you:

1. Write modern, idiomatic code, using your favourite npm dependencies
2. Be able to embed that code directly in an html file
3. Be able to run that html file and its embedded code with no external build step

## Usage

1. Find or upload the umd build of nostalgie to a public url.
2. Add a script tag to your html, pointing to the public nostalgie build.
3. Write your modern, npm-included code in script tags having `type="velcro"`.
4. ...
5. Now savour that sweet feeling of nostalgia for when the web was a simpler place...

In your html markup:

```html
<script src="https://cdn.jsdelivr.net/npm/nostalgie@0.48.0/dist/index.umd.js"></script>
```

The library will register a `load` even on the `window` object. The event handler will scan for all `<script type="velcro">` tags and will build and execute them sequentially.

Elsewhere in your html markup, use `script` tags with `type="velcro"` to author your custom code. Version resolution for references to modules therein _must_ be encoded in a `data-dependencies="<module>:<range>, <module2>:<range2>, ..."` attribute. Each such script tag must have its dependencies encoded.

```html
<script type="velcro" data-dependencies="preact:^10.4.4, github-markdown-css: ^4.0.0">
  /** @jsx h */

  import { h, render } from 'preact';
  import 'github-markdown-css';

  const name = 'hello world';

  render(
    <div className="markdown-body">
      <h1>Wow, such {name}</h1>
      <p>With <code>jsx</code>, <code>ES modules</code> and ✨.</p>
    </div>,
    document.body
  );
</script>
```

The code in `velcro` script tags will be interpreted as ESM or CommonJS, with optional jsx that supports the `/** @jsx <function> */` pragma. All npm dependencies will be discovered, resolved, bundled and sourcemapped before being executed.

Almost as if we were back in the glory days of jQuery, umd builds and public CDNs. Almost...
