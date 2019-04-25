import { ResolverHostUnpkg, CustomFetch } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { BareModuleResolver } from './types';
import { Velcro } from './velcro';

export { createCache } from './idb_cache';

type CreateRuntimeOptions = {
  cache?: Velcro.Cache;
  enableSourceMaps?: boolean;
  fetch?: CustomFetch;
  injectGlobal?: Velcro.GlobalInjector;
  resolveBareModule?: BareModuleResolver;
  resolverHost?: ResolverHost;
  resolver?: Resolver;
};

export function createRuntime(options: CreateRuntimeOptions = {}) {
  return new Velcro({
    cache: options.cache,
    injectGlobal: options.injectGlobal,
    resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
    resolver: new Resolver(options.resolverHost || new ResolverHostUnpkg({ fetch: options.fetch }), {
      packageMain: ['browser', 'main'],
    }),
  });
}

const resolveBareModuleToIdentity: BareModuleResolver = (_runtime, _resolver, href) => href;
