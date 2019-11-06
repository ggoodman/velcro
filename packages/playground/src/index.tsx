import React from 'react';
import ReactDOM from 'react-dom';
// import 'modern-css-reset';

import App from './components/App';
import * as serviceWorker from './serviceWorker';
import styled from '@emotion/styled';

const project = {
  'package.json':
    JSON.stringify(
      {
        dependencies: {
          '@emotion/core': '^10.0.17',
          '@emotion/styled': '^10.0.17',
          'github-markdown-css': '^3.0.1',
          react: '^16.9.0',
          'react-dom': '^16.9.0',
        },
      },
      null,
      2
    ) + '\n',
  'explanation.jsx':
    `
import React from 'react';

export const Explanation = () => <>
  <section>
    <h2>What is this?</h2>
    <p>
      This is a demo of bundling and serving a browser-based sandbox fully from the browser. <strong>There are <em>no</em> servers involved</strong> except the static server hosting this demo and <a href="https://unpkg.com" target="_blank" rel="noopener">unpkg.com</a>. All module resolution, transpilation and bundling is happening in the browser.
    </p>
    <p>
      Try it. Go offline, and reload...
    </p>
    <p>
      <strong>I dare you.</strong>
    </p>
  </section>
  <section>
    <h2>Features</h2>
    <ul>
      <li>Full offline support. Once your cache is seeded, you can cut the cord.</li>
      <li>Fully browser-based bundling.</li>
      <li>Add (almost) any node module and no server is involved.</li>
      <li>If you want to add another module, make sure to add it to <code>package.json</code> first.</li>
      <li>Automatic type acquisition for full typings support in the browser, in JavaScript!</li>
      <li>Resolve source locations in stack traces</li>
      <li>Hot module reloading</li>
    </ul>
  </section>
</>;
    `.trim() + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import 'github-markdown-css';
import './style.css';

import { Explanation } from './explanation';
import { name } from './name';

class Hello extends Component {
  render() {
    return <div className="markdown-body">
      <h1>Hello {this.props.toWhat}</h1>
      <blockquote>There is no <del>spoon</del> server</blockquote>
      <Explanation/>
    </div>;
  }
}
  
ReactDOM.render(
  <Hello toWhat={ name } />,
  document.getElementById('root')
);
      `.trim() + '\n',
  'name.js':
    `
export const name = 'Velcro';
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

const AppWrap = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  background: #333;

  ${App} {
    flex: 0 0 80vh;
    width: 80vw;
    background: white;
    box-shadow: 0 19px 38px rgba(0, 0, 0, 0.3), 0 15px 12px rgba(0, 0, 0, 0.22);
    max-height: 90vh;
  }
`;

ReactDOM.render(
  <AppWrap>
    <App initialPath="index.jsx" project={project} />
  </AppWrap>,
  document.getElementById('root')
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.register();
