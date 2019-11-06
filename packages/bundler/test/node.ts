import * as Vm from 'vm';

import { expect } from '@hapi/code';
import { script } from '@hapi/lab';
import { AbortController, fetch } from 'fetch-h2';

import { name } from '../package.json';
import * as Velcro from '../dist/dist-main';
import { Resolver, CanceledError } from '@velcro/resolver';
import { ResolverHostUnpkg } from '@velcro/resolver-host-unpkg';

export const lab = script({ cli: { globals: 'Velcro' } });

const { describe, it } = lab;

describe(`${name} in node`, { timeout: 200000 }, () => {
  describe('the Bundler will', () => {
    it('will load react@16 and this code will be executable', async () => {
      const resolverHost = new ResolverHostUnpkg({
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const bundle = await bundler.generateBundle([{ type: 'href', href: 'react' }], {
        dependencies: { react: '16.x' },
      });
      const code = bundle.toString({ executeEntrypoints: true, sourceMap: false });

      expect(code).to.be.a.string();

      const React = Vm.runInNewContext(code).require('react');

      expect(React).to.exist();
      expect(React.createElement).to.be.a.function();
    });

    it('will support cancellation', async () => {
      const resolverHost = new ResolverHostUnpkg({
        AbortController,
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const tokenSource = new Velcro.CancellationTokenSource();

      const bundlePromise = bundler.generateBundle(
        [
          {
            type: 'href',
            href: 'react@16',
          },
        ],
        {
          token: tokenSource.token,
          onEnqueueAsset() {
      tokenSource.cancel();
          },
        }
      );

      await expect(Promise.resolve(bundlePromise)).to.reject(CanceledError);
      console.debug('cancellation done');
    });

    it('will load create-hash@1.2 and this code will be executable', async () => {
      const resolverHost = new ResolverHostUnpkg({
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const bundle = await bundler.generateBundle([{ type: 'href', href: 'create-hash' }], {
        dependencies: { 'create-hash': '1.2.x' },
      });
      const code = bundle.toString({ executeEntrypoints: true, sourceMap: true });

      expect(code).to.be.a.string();

      const result = Vm.runInNewContext(code).require('create-hash');

      expect(result).to.be.a.function();
    });

    it('will load iconv-lite@0.4.24 and this code will be executable', async () => {
      const resolverHost = new ResolverHostUnpkg({
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const bundle = await bundler.generateBundle([{ type: 'href', href: 'iconv-lite' }], {
        dependencies: { 'iconv-lite': '0.4.24' },
      });
      const code = bundle.toString({ executeEntrypoints: true, sourceMap: true });

      expect(code).to.be.a.string();

      const result = Vm.runInNewContext(code).require('iconv-lite');

      expect(result.encode).to.be.a.function();
      expect(result.decode).to.be.a.function();
    });
  });
});
