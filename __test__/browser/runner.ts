/**
 * @jest-environment jsdom
 */

import { cssPlugin } from '@velcro/plugin-css';
import { execute } from '@velcro/runner';
import fetch from 'cross-fetch';

async function readUrl(href: string) {
  const res = await fetch(href, { redirect: 'follow' });

  if (!res.ok) {
    throw new Error(
      `Unexpected response while fetching ${JSON.stringify(href)}: ${res.status} ${res.statusText}`
    );
  }

  return res.arrayBuffer();
}

describe('Velcro.runner', () => {
  for (const cdn of ['jsdelivr', 'unpkg'] as const) {
    describe(cdn, () => {
      it('will run hello world', async () => {
        const code = `
          module.exports = 'hello world';
        `;
        const result = await execute(code, {
          cdn,
          readUrl: () => {
            throw new Error('Should not be called');
          },
          nodeEnv: 'production',
        });

        expect(result).toEqual('hello world');
      });

      it('will run hello with a css dependency', async () => {
        const code = `
          require('github-markdown-css');
    
          module.exports = 'hello world';
        `;
        const result = await execute(code, {
          cdn,
          dependencies: {
            'github-markdown-css': '4.0.0',
          },
          nodeEnv: 'production',
          plugins: [cssPlugin()],
          readUrl,
        });

        expect(result).toEqual('hello world');
      });

      it('will render hello world using react-dom/server', async () => {
        const code = `
          const React = require('react');
          const ReactDOMServer = require('react-dom/server');
    
          const h1 = React.createElement('h1', null, 'hello world');
    
          module.exports = ReactDOMServer.renderToString(h1);
        `;
        const result = await execute(code, {
          dependencies: {
            react: '^16.13.1',
            'react-dom': '^16.13.1',
          },
          readUrl,
          nodeEnv: 'production',
        });

        expect(result).toMatchInlineSnapshot(`"<h1 data-reactroot=\\"\\">hello world</h1>"`);
      });

      it('will render hello world using `htm/preact`', async () => {
        const code = `
          const { html } = require('htm/preact');
          const render = require('preact-render-to-string');
    
          const App = html\`<h1>Hello world</h1>\`;
    
          module.exports = render(App);
        `;
        const result = await execute(code, {
          cdn,
          dependencies: {
            htm: '^3.0.4',
            'preact-render-to-string': '^5.1.8',
          },
          readUrl,
          nodeEnv: 'development',
        });

        expect(result).toMatchInlineSnapshot(`"<h1>Hello world</h1>"`);
      });

      it('will run more complex package using react-dom/server', async () => {
        const code = `
          const React = require('react');
          const ReactDOMServer = require('react-dom/server');
          const Carousel = require('react-alice-carousel').default;
    
          const comp = React.createElement(Carousel, { items: [] });
    
          module.exports = ReactDOMServer.renderToString(comp);
        `;
        const result = await execute(code, {
          cdn,
          dependencies: {
            react: '^16.13.1',
            'react-dom': '^16.13.1',
            'react-alice-carousel': '1.18.0',
          },
          readUrl,
          nodeEnv: 'production',
        });

        expect(result).toMatchInlineSnapshot(
          `"<div class=\\"alice-carousel\\" data-reactroot=\\"\\"><div><div style=\\"height:;transition:;padding-left:0px;padding-right:0px\\" class=\\"alice-carousel__wrapper\\"><ul style=\\"transition:transform 0ms;transform:translate3d(0px, 0, 0)\\" class=\\"alice-carousel__stage\\"></ul></div></div><ul class=\\"alice-carousel__dots\\"></ul><div class=\\"alice-carousel__prev-btn\\"><div class=\\"alice-carousel__prev-btn-wrapper\\"><p class=\\"alice-carousel__prev-btn-item\\"><span data-area=\\"prev\\"></span></p></div></div><div class=\\"alice-carousel__next-btn\\"><div class=\\"alice-carousel__next-btn-wrapper\\"><p class=\\"alice-carousel__next-btn-item\\"><span data-area=\\"next\\"></span></p></div></div></div>"`
        );
      });

      it('will require the events shim', async () => {
        const code = `
          module.exports = require('events');
        `;
        const { EventEmitter } = await execute<typeof import('events')>(code, {
          readUrl,
          nodeEnv: 'production',
        });

        expect(typeof EventEmitter).toBe('function');

        const ee = new EventEmitter();

        expect(typeof ee.on).toBe('function');
      });
    });
  }
});
