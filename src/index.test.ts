import { Background } from '@ggoodman/context';
import tap from 'tap';
import { BareModuleResolver, JsDelivrCdn } from '.';

tap.test('resolving', async (t) => {
  await t.test('will throw on invalid specifiers', async (t) => {
    const resolver = new BareModuleResolver();

    await await t.rejects(
      () => resolver.resolve(Background(), 'reacting@/!'),
      TypeError
    );
  });
  await t.test('it resolves react@15', async (t) => {
    const resolver = new BareModuleResolver();
    const { url } = await resolver.resolve(
      Background(),
      'react@15/package.json'
    );

    t.equal(
      url.toString(),
      'https://cdn.jsdelivr.net/npm/react@15.7.0/package.json'
    );
  });
});

tap.test('JsDelivrCdn', async (t) => {
  await t.test('list the contents of a specific version', async (t) => {
    const cdn = new JsDelivrCdn();
    const entries = await cdn.listEntries(Background(), 'react', '15.0.0');

    t.matchSnapshot(entries.toJSON(), 'react@15.0.0 entry listing');
  });
});
