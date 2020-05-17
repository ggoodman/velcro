import Wreck from '@hapi/wreck';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from './cdnStrategy';

async function readUrl(href: string) {
  const { payload } = await Wreck.get(href, {});
  return payload as Buffer;
}

describe('@velcro/resolver', () => {
  it('will resolve `preact/react`', async () => {
    const strategy = CdnStrategy.forJsDelivr(readUrl);
    const resolver = new Resolver(strategy, {
      extensions: ['.js', '.json'],
      packageMain: ['browser', 'main'],
    });

    const result = await resolver.getUrlForBareModule('htm', '3.0.4', '/react');

    expect(result.found).toBe(true);
    expect(result.uri!.toString()).toEqual('https://cdn.jsdelivr.net/npm/htm@3.0.4/react/index.js');
  });
});
