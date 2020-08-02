export const files = {
  'package.json':
    JSON.stringify(
      {
        name: 'test',
        version: '0.0.0',
        dependencies: {
          'github-markdown-css': '^3.0.1',
          svelte: '^3.24.0',
        },
      },
      null,
      2
    ) + '\n',
  'index.jsx':
    `
import App from './App.svelte';

new App({
  target: document.body,
});
    `.trim() + '\n',
  'App.svelte':
    `
<script>
  import Explanation from './Explanation.svelte';
  import 'github-markdown-css';
</script>

<main class="markdown-body">
  <h1>Velcro Playground</h1>
  <blockquote>Example of 💯 % browser module loading and bundling.</blockquote>
  <Explanation />
</main>
  `.trim() + '\n',
  'Explanation.svelte':
    `
<section>
  <h2>Give it a try</h2>
  <p>Here's what you should try:</p>
  <ul>
    <li>✍️ Change any of the code you see.</li>
    <li>
      📦 Change any of the dependencies versions or introduce your own in the
      <code>package.json</code>
      file.
    </li>
    <li>💄 Try writing some css, or maybe making a TypeScript file...</li>
    <li>
      🕵🏼‍♂️ Checking out the action in the network tab of Developer Tools or seeing
      the generated source maps in the sources tab.
    </li>
  </ul>
</section>
<section>
  <h2>How does it work</h2>
  <p>
    Velcro is a fully web-based dependency resolver, loader and bundler. In this
    playground, it has been configured to treat files in the editor as being at
    <code>file://</code>
    , and npm modules as being at
    <code>https://cdn.jsdelivr.net</code>
    . Inter-module dependencies are all resolved to satisfy the requested ranges
    and are loaded at maximum concurrency from jsDelivr.
  </p>
  <p>
    As each file is resolved and read, it is run through a series of plugin
    hooks that are heavily inspired by Rollup. Each hook has a default fallback
    implementation that allows us to resolve, load and transform individual
    files. In the playground, Velcro has been configured with a css plugin and a
    <a
      href="https://github.com/alangpierce/sucrase"
      target="blank"
      rel="noopener">
      sucrase
    </a>
    plugin (for ESM and TypeScript).
  </p>
  <p>
    After processing each individual file, we parse it so that its AST can be
    traversed to:
  </p>
  <ul>
    <li>Calculate scope metadata and identifier bindings</li>
    <li>
      Identify calls to
      <code>require</code>
    </li>
    <li>Identify calls Node.js global objects so that shims can be injected</li>
    <li>
      Prune branches based on
      <code>process.env.NODE_ENV</code>
    </li>
  </ul>
  <p>
    This work allows us to build out a full dependency graph of modules. This
    graph has information about every url consulted at each step of the process,
    so small parts of it can be efficiently invalidated. Once the graph is
    complete, it can be serialized into a bundle of JavaScript code. At this
    point, we can decide if we want to include source maps or not.
  </p>
  <p>
    The bundled code is written to browser-internal storage using the
    <code>File</code>
    API and an
    <code>iframe</code>
    is constructed dynamically that links to this. Every new generation of
    bundle will cause the
    <code>iframe</code>
    to be replaced.
  </p>
</section>
  `.trim() + '\n',
};
