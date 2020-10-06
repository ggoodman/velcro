import Wreck from '@hapi/wreck';
import { execute } from '@velcro/runner';

async function readUrl(href: string) {
  const { res, payload } = await Wreck.get(href, { redirects: 3 });
  if (res.statusCode !== 200) {
    throw new Error(
      `Unexpected response while reading ${JSON.stringify(href)}: ${res.statusCode} ${
        res.statusMessage
      }`
    );
  }
  return payload as Buffer;
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

      it('will render hello world using react-dom/server', async () => {
        const code = `
          const React = require('react');
          const ReactDOMServer = require('react-dom/server');
    
          const h1 = React.createElement('h1', null, 'hello world');
    
          module.exports = ReactDOMServer.renderToString(h1);
        `;
        const result = await execute(code, {
          cdn,
          dependencies: {
            react: '^16.13.1',
            'react-dom': '^16.13.1',
          },
          readUrl,
          nodeEnv: 'production',
        });

        expect(result).toMatchInlineSnapshot(`"<h1 data-reactroot=\\"\\">hello world</h1>"`);
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
          cdn,
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
