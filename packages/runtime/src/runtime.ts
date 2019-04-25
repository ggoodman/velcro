import { ResolverHostUnpkg, CustomFetch } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { BareModuleResolver, GlobalInjector, ICache } from './types';
import { Velcro } from './velcro';
import { injectGlobalFromUnpkg } from './unpkg';
// import { createCache } from './idb_cache';

type CreateRuntimeOptions = {
  cache?: ICache;
  enableSourceMaps?: boolean;
  fetch?: CustomFetch;
  injectGlobal?: GlobalInjector;
  resolveBareModule?: BareModuleResolver;
  resolverHost?: ResolverHost;
  resolver?: Resolver;
};

export function createRuntime(options: CreateRuntimeOptions = {}) {
  return new Velcro({
    // cache: createCache('@velcro/runtime'),
    injectGlobal: injectGlobalFromUnpkg,
    resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
    resolver: new Resolver(options.resolverHost || new ResolverHostUnpkg({ fetch: options.fetch }), {
      packageMain: ['browser', 'main'],
    }),
  });
}

const resolveBareModuleToIdentity: BareModuleResolver = (_resolver, href) => href;
