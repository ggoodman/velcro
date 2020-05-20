import Wreck from '@hapi/wreck';
import { execute } from '@velcro/runner';

async function readUrl(href: string) {
  const { payload } = await Wreck.get(href, {});
  return payload as Buffer;
}

describe('Velcro.runner', () => {
  it('will run hello world', async () => {
    const code = `
      module.exports = 'hello world';
    `;
    const result = await execute(code, {
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
      dependencies: {
        react: '^16.13.1',
        'react-dom': '^16.13.1',
      },
      readUrl,
      nodeEnv: 'production',
    });

    expect(result).toEqual('<h1 data-reactroot="">hello world</h1>');
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
