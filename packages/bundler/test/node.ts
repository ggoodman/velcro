import { expect } from '@hapi/code';
import { script } from '@hapi/lab';
import { fetch } from 'fetch-h2';
import * as Fs from 'fs-extra';

import { name } from '../package.json';
import * as Velcro from '../dist/dist-main';

export const lab = script();

const { describe, it } = lab;

describe(`${name} in node`, { timeout: 200000 }, () => {
  describe('the Bundler will', () => {
    it('will load react@16', async () => {
      const resolverHost = new Velcro.ResolverHostUnpkg({
        fetch: (...args: Parameters<typeof fetch>) => {
          console.log('fetching', ...args);

          return fetch(...args);
        },
      });
      const resolver = new Velcro.Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });

      await Promise.all([bundler.add('react'), bundler.add('react-dom')]);

      for (const [bundleName, bundle] of bundler.assetGroups) {
        expect(bundle).to.exist();

        const bundleString = bundle!.generateCode({ sourceMap: true });

        expect(bundleString).to.be.a.string();

        await Fs.writeFile(
          `${__dirname}/../${Velcro.util.basename(bundleName)}.js`,
          `eval(${JSON.stringify(bundleString)})`
        );

        console.log(bundleName, bundle!.generateLinkManifest());
      }
    });
  });
});
