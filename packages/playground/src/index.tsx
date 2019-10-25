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
      This is a demo of bundling and serving a browser-based sandbox fully from the browser.
      Try it. Go offline, and reload... I dare you.
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
    </ul>
  </section>
</>;
    `.trim() + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import { Global, css } from '@emotion/core';
import styled from '@emotion/styled';

import { Explanation } from './explanation';
import { name } from './name';

const Red = styled.h1\`
  color: #fff5f5;
  font-size: 64px;
\`;

class Hello extends Component {
  render() {
    return <>
      <Global styles={css\`
        body {
          background-color: #6c6666;
          color: #f5f5f5;
          font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
          padding: 1em 4em;
        }
      \`}/>
      <Red>Hello {this.props.toWhat}</Red>
      <Explanation/>
    </>;
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
