import { ResolverHostUnpkg, CustomFetch } from '@velcro/resolver-host-unpkg';
import { ResolverHostZip } from '@velcro/resolver-host-zip';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { SystemHostUnpkg } from './system_host';
import { System, SystemHost } from './system';
import { BareModuleResolver, GlobalInjector, ICache } from './types';
import { ResolverHostCompound } from '../dist/dist-main';

type CreateRuntimeOptions = {
  cache?: ICache;
  fetch?: CustomFetch;
  injectGlobal?: GlobalInjector;
  resolveBareModule?: BareModuleResolver;
  resolverHost?: ResolverHost;
  resolver?: Resolver;
  systemHost?: SystemHost;
};

export function createRuntime(options: CreateRuntimeOptions = {}) {
  const systemHost =
    options.systemHost ||
    new SystemHostUnpkg(
      options.resolver ||
        new Resolver(options.resolverHost || new ResolverHostUnpkg({ fetch: options.fetch }), {
          packageMain: ['browser', 'main'],
        }),
      {
        cache: options.cache,
        injectGlobal: options.injectGlobal,
        resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
      }
    );

  return new System(systemHost);
}

interface CreateGithubRuntimeOptions {
  cache?: ICache;
  fetch?: CustomFetch;

  /**
   * Git hashish (branch, tag, sha) to pull from
   */
  hashish?: string;
  injectGlobal?: GlobalInjector;
  resolveBareModule?: BareModuleResolver;
  /**
   * Repository identifier in the form <user>/<repo>
   */
  repositoryName: string;
}

export function createRuntimeForGithubRepo(options: CreateGithubRuntimeOptions) {
  const githubResolverHost = new ResolverHostZip({
    fetch: options.fetch,
    zipUrl: `https://github.com/${options.repositoryName}/archive/${options.hashish || 'master'}.zip`,
  });
  const unpkgResolverHost = new ResolverHostUnpkg({ fetch: options.fetch });
  const resolverHost = new ResolverHostCompound({
    'https://unpkg.com/': unpkgResolverHost,
    [`https://github.com/${options.repositoryName}/`]: githubResolverHost,
  });

  const systemHost = new SystemHostUnpkg(
    new Resolver(resolverHost, {
      packageMain: ['browser', 'main'],
    }),
    {
      cache: options.cache,
      injectGlobal: options.injectGlobal,
      resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
    }
  );

  return new System(systemHost);
}

const resolveBareModuleToIdentity: BareModuleResolver = (_system, _resolver, href) => href;
