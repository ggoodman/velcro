import React from 'react';
import ReactDOM from 'react-dom';

import { App } from './App';
import * as serviceWorker from './serviceWorker';

serviceWorker.unregister();

ReactDOM.render(<App />, document.getElementById('root'));
