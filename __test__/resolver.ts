import Wreck from '@hapi/wreck';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';

async function readUrl(href: string) {
  const { payload } = await Wreck.get(href, {});
  return payload as Buffer;
}

describe('Velcro.Resolver', () => {
  it('will resolve htm/react', async () => {
    const strategy = CdnStrategy.forJsDelivr(readUrl);
    const resolver = new Resolver(strategy, {
      extensions: ['.js', '.json'],
      packageMain: ['browser', 'main'],
    });

    const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

    expect(result.found).toBe(true);
    expect(result.uri!.toString()).toEqual('https://cdn.jsdelivr.net/npm/htm@3.0.4/react/index.js');
  });

  it('will resolve htm from htm/react', async () => {
    const strategy = CdnStrategy.forJsDelivr(readUrl);
    const resolver = new Resolver(strategy, {
      extensions: ['.js', '.json'],
      packageMain: ['browser', 'main'],
    });

    const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

    expect(result.found).toBe(true);
    expect(result.uri!.toString()).toEqual('https://cdn.jsdelivr.net/npm/htm@3.0.4/react/index.js');

    const result2 = await resolver.resolve('htm', result.uri!);

    expect(result2.found).toBe(true);
    expect(result2.uri!.toString()).toEqual('https://cdn.jsdelivr.net/npm/htm@3.0.4/dist/htm.js');
  });
});
