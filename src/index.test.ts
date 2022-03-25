import { Background } from '@ggoodman/context';
import tap from 'tap';
import { BareModuleResolver, JsDelivrCdn } from '.';
import { assertPackageJsonWithNameAndVersion } from './types';

tap.test('resolving', async (t) => {
  const cdn = new JsDelivrCdn();

  await t.test('will throw on invalid specifiers', async (t) => {
    const resolver = new BareModuleResolver();

    await await t.rejects(
      () =>
        resolver.resolve(
          Background(),
          'reacting@/!',
          cdn.createReference('react', '15', '/')
        ),
      TypeError
    );
  });

  await t.test('it resolves "prop-types" from "react@15"', async (t) => {
    const resolver = new BareModuleResolver();
    const fromRef = cdn.createReference('react', '15');
    const { url } = await resolver.resolve(Background(), 'prop-types', fromRef);

    t.equal(url.toString(), 'https://cdn.jsdelivr.net/npm/prop-types@15.8.1');
  });
});

tap.test('JsDelivrCdn', async (t) => {
  const cdn = new JsDelivrCdn();

  await t.test('list the contents of a specific version', async (t) => {
    const listing = await cdn.listEntries(Background(), 'react', '15.0.0');

    t.equal(listing.entries.length, 7, 'react@15.0.0 entry listing size');
  });

  await t.test('reads the package.json of react@15', async (t) => {
    const listing = await cdn.readFileContentsAsJson(
      Background(),
      cdn.createReference('react', '15', '/package.json')
    );

    assertPackageJsonWithNameAndVersion(listing);

    t.equal(listing.name, 'react', 'has the correct .name');
    t.ok(listing.version.startsWith('15.'), 'has the correct major version');
  });
});
