import { ResolverHostUnpkg, CustomFetch } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { SystemHostUnpkg } from './system_host';
import { System, SystemHost } from './system';
import { BareModuleResolver, GlobalInjector, ICache } from './types';

type CreateRuntimeOptions = {
  cache?: ICache;
  enableSourceMaps?: boolean;
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
        enableSourceMaps: options.enableSourceMaps,
        injectGlobal: options.injectGlobal,
        resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
      }
    );

  return new System(systemHost);
}

const resolveBareModuleToIdentity: BareModuleResolver = (_system, _resolver, href) => href;
