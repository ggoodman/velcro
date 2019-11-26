/* eslint-disable no-restricted-globals */
import { expose, Transport } from '@ggoodman/rpc';
import { Bundler } from '@velcro/bundler';
import { Resolver, ResolvedEntry, ResolverHost, ResolvedEntryKind } from '@velcro/resolver';
import { RuntimeOptions } from '@velcro/bundler/dist/dist-main/types';
import { ResolverHostUnpkg } from '@velcro/resolver-host-unpkg';
import { ResolverHostWithCache } from './ResolverHostWithCache';
import { ResolverHostMemory } from '@velcro/resolver-host-memory';
import { ResolverHostWithInflightCache } from './ResolverHostWithInflightCache';
import { ResolverHostCompound } from '@velcro/resolver-host-compound';
import resolveNpmSpec from 'npm-package-arg';
import { NotSupportedError } from './error';
import { TypeAcquirer } from './typeAcquisition';
import { createBundleRuntime } from './previewRuntime';

const unpkgCdn = ResolverHostUnpkg.forNpmFromJsdelivr();
const githubCdn = ResolverHostUnpkg.forGithubFromJsdelivr();
const cachingUnpkgHost = new ResolverHostWithCache(unpkgCdn, {
  namespace: unpkgCdn.getRoot().href,
});

const previewRuntimeHost = new ResolverHostMemory(
  {
    'index.js': `(${createBundleRuntime.toString().replace(/velcroRequire/g, 'require')})();`,
    'package.json': JSON.stringify({
      dependencies: {
        'react-error-overlay': '^6.0.3',
      },
    }),
  },
  'preview'
);
export type HostApi = {
  getCanonicalUrl(href: string): Promise<string>;
  getResolveRoot(href: string): Promise<string>;
  listEntries(href: string): Promise<{ type: ResolvedEntryKind; href: string }[]>;
  readFileContent(href: string): Promise<string>;
};

const hostResolverHost: ResolverHost = {
  async getCanonicalUrl(_resolver: Resolver, url: URL): Promise<URL> {
    const href = await remoteApi.invoke('getCanonicalUrl', url.href);

    return new URL(href);
  },

  async getResolveRoot(_resolver: Resolver, url: URL): Promise<URL> {
    const href = await remoteApi.invoke('getResolveRoot', url.href);

    return new URL(href);
  },

  async listEntries(_resolver: Resolver, url: URL): Promise<ResolvedEntry[]> {
    const entries = await remoteApi.invoke('listEntries', url.href);

    return entries.map(entry => {
      return {
        type: entry.type,
        url: new URL(entry.href),
      };
    });
  },

  async readFileContent(_resolver: Resolver, url: URL): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const content = await remoteApi.invoke('readFileContent', url.href);

    return encoder.encode(content);
  },
};
const resolverHost = new ResolverHostWithInflightCache(
  new ResolverHostCompound({
    [unpkgCdn.getRoot().href]: cachingUnpkgHost,
    [previewRuntimeHost.getRoot().href]: previewRuntimeHost,
    'file:///': hostResolverHost,
  })
);
const resolver = new Resolver(resolverHost, {
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  packageMain: ['browser', 'main'],
});
const typeAcquirer = new TypeAcquirer(resolver, resolveBareModule);
const bundler = new Bundler({
  resolver,
  resolveBareModule,
});

const workerApi = {
  generateBundle: async (
    entrypoints: string[],
    onEnqueueAsset: () => void,
    onCompleteAsset: () => void,
    options: Bundler.BundleOptions & RuntimeOptions & { sourceMap?: boolean }
  ) => {
    const bundle = await bundler.generateBundle(entrypoints, {
      onCompleteAsset,
      onEnqueueAsset,
      incremental: options.incremental,
      invalidations: options.invalidations,
    });

    const code = bundle.toString({
      executeEntrypoints: options.executeEntrypoints,
      runtime: options.runtime,
      sourceMap: options.sourceMap,
    });
    const invalidations = Array.from(bundle.assets).map(asset => asset.href);

    return { code, invalidations };
  },
  importTypesForSpecs: async (
    specs: { [name: string]: string },
    onFile: (file: { content: string; pathname: string }) => void
  ) => {
    let disposable: { dispose(): void } | undefined = undefined;
    try {
      disposable = typeAcquirer.onTypeFile(onFile);

      await typeAcquirer.importTypesForSpecs(specs);
    } finally {
      if (disposable) {
        disposable.dispose();
      }
    }
  },
  resolve: async (spec: string) => {
    const resolveResult = await resolver.resolve(spec);

    return resolveResult.resolvedUrl ? resolveResult.resolvedUrl.href : undefined;
  },
};

const remoteApi = expose(workerApi).connect<HostApi>(Transport.fromDomWorker((self as unknown) as Worker));

export type WorkerApi = typeof workerApi;

function resolveBareModule(spec: string, pathname?: string) {
  const npmSpec = resolveNpmSpec(spec);

  switch (npmSpec.type) {
    case 'range':
    case 'version': {
      return unpkgCdn.resolveBareModule(spec, pathname);
    }
    case 'git': {
      if (npmSpec.hosted && npmSpec.hosted.type === 'github') {
        const resolvedSpec = `${npmSpec.hosted.user}/${npmSpec.hosted.project}@${npmSpec.gitRange ||
          npmSpec.gitCommittish}`;
        return githubCdn.resolveBareModule(resolvedSpec, pathname);
      }

      throw new NotSupportedError(
        `Unable to resolve '${spec}' because dependencies of type '${npmSpec.type}' are not yet supported`
      );
    }
    default: {
      debugger;
      throw new NotSupportedError(
        `Unable to resolve '${spec}' because dependencies of type '${npmSpec.type}' are not yet supported`
      );
    }
  }
}
