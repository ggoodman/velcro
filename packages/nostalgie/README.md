# nostalgie

![npm (scoped)](https://img.shields.io/npm/v/nostalgie?style=flat-square)
![NPM](https://img.shields.io/npm/l/nostalgie?style=flat-square)

A reminder of what the web once was - your hopes and dreams and a single html file.

Nostalgie, not so suprisingly, means _nostalgia_ in French. The latter was taken and I speak French at home so here we are! An ode to a simpler time. A time when the code you wrote was the code that ran and the biggest source of complexity was finding the modules you wanted on a suitable CDN.

[API Docs](https://github.com/ggoodman/velcro/tree/v0.37.0/docs/nostalgie.md)

## Usage

Import the `nostalgie` umd build in your html markup:

```html
<script src="https://cdn.jsdelivr.net/npm/nostalgie@0.37.0/dist/index.umd.js"></script>
```

The library will register a `load` even on the `window` object. The event handler will scan for all `<script type="velcro">` tags and will build and execute them sequentially.

The `<script type="velcro">` tags may include a `data-dependencies="<module>:<range>, <module2>:<range2>, ..."` data attribute to declare which versions of packages to use for direct dependencies of the code in that script tag.

The code in such script tags will be interpreted as (optionally) ESM with jsx and all npm dependencies will be discovered, bundled and sourcemapped before being executed. Almost as if we were back in the glory days of jQuery.
