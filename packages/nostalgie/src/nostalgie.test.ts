/**
 * @jest-environment jsdom
 */

import fetch from 'cross-fetch';
import { refresh } from './nostalgie';

describe('Velcro.nostalgie', () => {
  window.fetch = fetch;

  afterEach(() => {
    document.getElementsByTagName('html')[0].innerHTML = '';
  });

  it('a single script', async () => {
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('type', 'velcro');
    scriptEl.text = `document.body.innerHTML = 'hello world';`;
    document.head.appendChild(scriptEl);

    await refresh();

    expect(document.body.innerHTML).toBe('hello world');
  });

  it('multiple scripts, in sequence', async () => {
    for (let i = 0; i < 10; i++) {
      const scriptEl = document.createElement('script');
      scriptEl.setAttribute('type', 'velcro');
      scriptEl.text = `document.body.innerHTML += ${i};`;
      document.head.appendChild(scriptEl);
    }

    await refresh();

    expect(document.body.innerHTML).toBe('0123456789');
  });

  it('render a simple react script', async () => {
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('type', 'velcro');
    scriptEl.dataset['dependencies'] = 'react:^16.13.0, react-dom: ^16.13.0';
    scriptEl.text = `
      import React from 'react';
      import { render } from 'react-dom';

      const name = 'world';

      render(<h1>Hello {name}</h1>, document.getElementById('root'));
    `;
    document.head.appendChild(scriptEl);
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await refresh();

    expect(document.body.innerHTML).toBe('<div id="root"><h1>Hello world</h1></div>');
  });
});
