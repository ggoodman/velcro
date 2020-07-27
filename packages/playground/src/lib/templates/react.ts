export const id = 'react';

export const name = 'React Template';

export const defaultFile = 'App.jsx';

export const files: Record<string, string> = {
  'package.json':
    JSON.stringify(
      {
        name: 'react-template',
        version: '0.0.0',
        dependencies: {
          'github-markdown-css': '^3.0.1',
          react: '^16.9.0',
          'react-dom': '^16.9.0',
        },
        main: './index.jsx',
      },
      null,
      2
    ) + '\n',
  [defaultFile]: `
import React, { Component } from 'react';
import 'github-markdown-css';

import { Explanation } from './explanation';
import './style.css';

class App extends Component {
  render() {
    return <div className="markdown-body">
      <h1>Velcro Playground</h1>
      <blockquote>Example of 💯 % browser module loading and bundling.</blockquote>
      <Explanation/>
    </div>;
  }
}

export default App
  `.trim(),
  'explanation.jsx':
    `
import React from 'react';

export const Explanation = () => <>
  <section>
    <h2>Give it a try</h2>
    <p>Here's what you should try:</p>
    <ul>
      <li>✍️ Change any of the code you see.</li>
      <li>📦 Change any of the dependencies versions or introduce your own in the <code>package.json</code> file.</li>
      <li>💄 Try writing some css, or maybe making a TypeScript file...</li>
      <li>🕵🏼‍♂️ Checking out the action in the network tab of Developer Tools or seeing the generated source maps in the sources tab.</li>
    </ul>
  </section>
  <section>
    <h2>How does it work</h2>
    <p>
      Velcro is a fully web-based dependency resolver, loader and bundler. In this playground, it has been configured to treat files
      in the editor as being at <code>file://</code>, and npm modules as being at <code>https://cdn.jsdelivr.net</code>. Inter-module
      dependencies are all resolved to satisfy the requested ranges and are loaded at maximum concurrency from jsDelivr.
    </p>
    <p>
      As each file is resolved and read, it is run through a series of plugin hooks that are heavily inspired by Rollup.
      Each hook has a default fallback implementation that allows us to resolve, load and transform individual files.
      In the playground, Velcro has been configured with a css plugin and a <a href="https://github.com/alangpierce/sucrase" target="blank" rel="noopener">sucrase</a>
      plugin (for ESM and TypeScript).
    </p>
    <p>
      After processing each individual file, we parse it so that its AST can be traversed to:
    </p>
    <ul>
      <li>Calculate scope metadata and identifier bindings</li>
      <li>Identify calls to <code>require</code></li>
      <li>Identify calls Node.js global objects so that shims can be injected</li>
      <li>Prune branches based on <code>process.env.NODE_ENV</code></li>
    </ul>
    <p>
      This work allows us to build out a full dependency graph of modules. This graph has information about
      every url consulted at each step of the process, so small parts of it can be efficiently invalidated.
      Once the graph is complete, it can be serialized into a bundle of JavaScript code. At this point, we
      can decide if we want to include source maps or not.
    </p>
    <p>
      The bundled code is written to browser-internal storage using the <code>File</code> API and an
      <code>iframe</code> is constructed dynamically that links to this. Every new generation of bundle
      will cause the <code>iframe</code> to be replaced.
    </p>
  </section>
</>;
    `.trim() + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import App from './App';
  
ReactDOM.render(
  <App/>,
  document.getElementById('root')
);
      `.trim() + '\n',
  'style.css':
    `
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}

@media (max-width: 767px) {
  .markdown-body {
    padding: 15px;
  }
}
    `.trim() + '\n',
};
