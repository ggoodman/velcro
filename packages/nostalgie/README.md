# Nostalgie

![npm (scoped)](https://img.shields.io/npm/v/nostalgie?style=flat-square)
![NPM](https://img.shields.io/npm/l/nostalgie?style=flat-square)

> **A reminder of what the web once was—a text editor, a browser and your imagination.**

_Nostalgie_ means nostalgia in French. This library is an ode to a simpler time; a time before _bundlers_ and before _transpilation_. A time when the code you wrote was the code that ran and the biggest source of complexity was finding the modules you wanted on a CDN and putting them in the _right order_.

This project is an attempt to restore some of that simplicity. With it, you should be able to:

1. Write modern, idiomatic code, referencing all your favourite [npm](https://npmjs.com) dependencies.
2. Put all that beautiful code of yours in a `<script></script>` tag referencing `nostalgie`.
3. Open that file in your browser _du jour_.

...

That's it. Really, that's all.

## Examples

In your html markup:

> Note: This example kind of defeats the purpose of using nostalgie since it will run fine without the ✨.

```html
<script src="https://cdn.jsdelivr.net/npm/nostalgie@/dist/index.umd.js">
  console.log("Ummm, can't I already do this without nostalgie...?");
</script>
```

OK, fine. Well if you want to get all fancy on me with your "npm module here, npm module there" shenanigans, let's flex a couple muscles:

```html
<script
  data-dependencies="react:^16.13.1, react-dom:^16.13.1"
  src="https://cdn.jsdelivr.net/npm/nostalgie@/dist/index.umd.js"
>
  import React from 'react';
  import ReactDOM from 'react-dom';

  ReactDOM.render(
    <h1>Hello, world!</h1>,
    document.body
  );
</script>
```

Wait, what?

You must be special-casing react, right?

OK, let's try something else:

```html
<script
  data-dependencies="preact:^10.4.4, github-markdown-css: ^4.0.0"
  src="https://cdn.jsdelivr.net/npm/nostalgie@/dist/index.umd.js"
>
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

And just for fun, let's get a bit more crazy!

```html
<div id="root">Wait for it! Loading some ✨ from the ☁️.</div>
<script
  src="https://cdn.jsdelivr.net/npm/nostalgie@/dist/index.umd.js"
  data-dependencies="react:^16.13.1, react-dom:^16.13.1, react-ui: ^1.0.0-beta.26"
>
  import React from 'react';
  import { render } from 'react-dom';
  import { Button, Card, Form, Input, Select, Stack, Switch, Textarea, ThemeProvider } from 'react-ui';
  import { tokens, components } from 'react-ui/themes/light'

  const App = () =>
    <Form>
      <Form.Header as="h2">Update profile details</Form.Header>
      <Form.Field label="Full name" required>
        <Input placeholder="Enter your username" />
      </Form.Field>
      <Form.Field label="Email">
        <Input placeholder="Enter your email" />
      </Form.Field>
      <Form.Field label="Change password">
        <Input placeholder="Enter a password" />
      </Form.Field>
      <Form.Field label="Weather">
        <Select>
          <option value="">What's the weather like?</option>
          <option value="hot">Hot</option>
          <option value="cold">Cold</option>
        </Select>
      </Form.Field>
      <Form.Field label="Address">
        <Textarea placeholder="Enter your address" />
      </Form.Field>
      <Form.Field label="Remember me">
        <Switch />
      </Form.Field>
      <Stack>
        <Button>Update profile</Button>
        <Button variant="link">Cancel</Button>
      </Stack>
    </Form>;

  render(
    <ThemeProvider tokens={tokens} components={components}>
      <App />
    </ThemeProvider>,
    document.getElementById('root')
  );
</script>
```

## How it works

The code in `velcro` script tags will be interpreted as ESM or CommonJS, with optional jsx that supports the `/** @jsx <function> */` pragma. All npm dependencies will be discovered, resolved, bundled and even source-mapped before being executed.

**It is almost as if we were back in the glory days of jQuery. The days of public CDNs and global variables and... Well, almost...**
