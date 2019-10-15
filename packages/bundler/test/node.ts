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
      const bundle = await bundler.generateBundleCode(['react@16'], { requireEntrypoints: true, sourceMap: true });

      expect(bundle).to.be.a.string();

      const React = Vm.runInNewContext(bundle);

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

      tokenSource.cancel();

      const bundlePromise = bundler.generateBundleCode(['react@16'], {
        requireEntrypoints: true,
        sourceMap: true,
        token: tokenSource.token,
      });
      await expect(Promise.resolve(bundlePromise)).to.reject(CanceledError, 'Canceled');
    });

    it('will load create-hash@1.2 and this code will be executable', async () => {
      const resolverHost = new ResolverHostUnpkg({
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const bundle = await bundler.generateBundleCode(['create-hash@1.2'], {
        requireEntrypoints: true,
        sourceMap: true,
      });

      expect(bundle).to.be.a.string();

      const result = Vm.runInNewContext(bundle);

      expect(result).to.exist();
    });

    it('will load iconv-lite@0.4.24 and this code will be executable', async () => {
      const resolverHost = new ResolverHostUnpkg({
        fetch,
      });
      const resolver = new Resolver(resolverHost, { packageMain: ['browser', 'main'] });
      const bundler = new Velcro.Bundler({ resolver });
      const bundle = await bundler.generateBundleCode(['iconv-lite@0.4.24'], {
        requireEntrypoints: true,
        sourceMap: true,
      });

      expect(bundle).to.be.a.string();

      const result = Vm.runInNewContext(bundle);

      expect(result).to.exist();
    });
  });
});
