import { expect } from '@hapi/code';
import { script } from '@hapi/lab';
import { fetch } from 'fetch-h2';

import { name } from '../package.json';
import * as Velcro from '../dist/dist-main';

export const lab = script();

const { describe, it } = lab;

describe(`${name} in node`, { timeout: 200000 }, () => {
  describe('the Bundler will', () => {
    it('will load react@16 and this code will be executable', async () => {
      const resolverHost = new Velcro.ResolverHostUnpkg({
        fetch: (...args: Parameters<typeof fetch>) => {
          console.log('fetching', ...args);

          return fetch(...args);
        },
      });
      const resolver = new Velcro.Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });

      await bundler.add('react@16');

      const bundle = bundler.generateBundleCode({ sourceMap: true });
      expect(bundle).to.be.a.string();

      eval(bundle);

      const React = Velcro.runtime.require('react@16');

      expect(React).to.exist();
      expect(React.createElement).to.be.a.function();
    });
  });
});
