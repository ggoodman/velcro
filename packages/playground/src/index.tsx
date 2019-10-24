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
          '@emotion/styled': '^10.0.17',
          react: '^16.9.0',
          'react-dom': '^16.9.0',
        },
      },
      null,
      2
    ) + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import styled from '@emotion/styled';

import { name } from './name';

const Red = styled.div\`
  color: green;
\`;

class Hello extends Component {
  render() {
    return <Red>Hello {this.props.toWhat}</Red>;
  }
}

ReactDOM.render(
  <Hello toWhat={ name } />,
  document.getElementById('root')
);
      `.trim() + '\n',
  'name.js':
    `
export const name = 'World';
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
serviceWorker.unregister();
