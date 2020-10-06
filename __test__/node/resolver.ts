import Wreck from '@hapi/wreck';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';

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

describe('Velcro.Resolver', () => {
  describe('jsDelivr', () => {
    it('will resolve htm/react', async () => {
      const strategy = CdnStrategy.forJsDelivr(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual(
        'https://cdn.jsdelivr.net/npm/htm@3.0.4/react/index.js'
      );
    });

    it('will resolve react-dom/server', async () => {
      const strategy = CdnStrategy.forJsDelivr(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('react-dom', '16.13.1', '/server');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual(
        'https://cdn.jsdelivr.net/npm/react-dom@16.13.1/server.browser.js'
      );
    });

    it('will resolve htm from htm/react', async () => {
      const strategy = CdnStrategy.forJsDelivr(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual(
        'https://cdn.jsdelivr.net/npm/htm@3.0.4/react/index.js'
      );

      const result2 = await resolver.resolve('htm', result.uri!);

      expect(result2.found).toBe(true);
      expect(result2.uri!.toString()).toEqual('https://cdn.jsdelivr.net/npm/htm@3.0.4/dist/htm.js');
    });
  });

  describe('unpkg', () => {
    it('will resolve htm/react', async () => {
      const strategy = CdnStrategy.forUnpkg(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual('https://unpkg.com/htm@3.0.4/react/index.js');
    });

    it('will resolve react-dom/server', async () => {
      const strategy = CdnStrategy.forUnpkg(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('react-dom', '16.13.1', '/server');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual(
        'https://unpkg.com/react-dom@16.13.1/server.browser.js'
      );
    });

    it('will resolve htm from htm/react', async () => {
      const strategy = CdnStrategy.forUnpkg(readUrl);
      const resolver = new Resolver(strategy, {
        extensions: ['.js', '.json'],
        packageMain: ['browser', 'main'],
      });

      const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

      expect(result.found).toBe(true);
      expect(result.uri!.toString()).toEqual('https://unpkg.com/htm@3.0.4/react/index.js');

      const result2 = await resolver.resolve('htm', result.uri!);

      expect(result2.found).toBe(true);
      expect(result2.uri!.toString()).toEqual('https://unpkg.com/htm@3.0.4/dist/htm.js');
    });
  });
});
