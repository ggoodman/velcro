import React from 'react';
import ReactDOM from 'react-dom';
import 'modern-css-reset';

import App from './components/App';
import * as serviceWorker from './serviceWorker';

const project = {
  'package.json': JSON.stringify(
    {
      dependencies: {
        react: '^16.9.0',
        'react-dom': '^16.9.0',
      },
    },
    null,
    2
  ),
  'script.jsx': `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import { name } from './name';

class Hello extends Component {
  render() {
    return <div>Hello {this.props.toWhat}</div>;
  }
}

ReactDOM.render(
  <Hello toWhat={ name } />,
  document.getElementById('root')
);
    `.trim(),
};

ReactDOM.render(<App initialPath="script.jsx" project={project} />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
