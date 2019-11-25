/* eslint-disable no-restricted-globals */
import { expose, Transport } from '@ggoodman/rpc';
import { Bundler } from '@velcro/bundler';
import {
  Resolver,
  CancellationToken,
  AbstractResolverHost,
  ResolvedEntry,
  ResolverHost,
  ResolvedEntryKind,
} from '@velcro/resolver';
import { RuntimeOptions } from '@velcro/bundler/dist/dist-main/types';

export type HostApi = {
  getCanonicalUrl(href: string): Promise<string>;
  getResolveRoot(href: string): Promise<string>;
  listEntries(href: string): Promise<{ type: ResolvedEntryKind; href: string }[]>;
  readFileContent(href: string): Promise<string>;
  resolveBareModule(spec: string, pathname?: string): Promise<string>;
};

const resolverHost: ResolverHost = {
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

const bundler = new Bundler({
  resolver: new Resolver(resolverHost, {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    packageMain: ['browser', 'main'],
  }),
  async resolveBareModule(spec: string, pathname?: string) {
    const href = await remoteApi.invoke('resolveBareModule', spec, pathname);

    return new URL(href);
  },
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
      invalidations: options.invalidations,
    });

    return bundle.toString({
      executeEntrypoints: options.executeEntrypoints,
      runtime: options.runtime,
      sourceMap: options.sourceMap,
    });
  },
};

const remoteApi = expose(workerApi).connect<HostApi>(Transport.fromDomWorker((self as unknown) as Worker));

export type WorkerApi = typeof workerApi;
