import { ResolverHostUnpkg, CustomFetch } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { BareModuleResolver } from './types';
import { Runtime } from './runtime';

export { createCache } from './idb_cache';

type CreateRuntimeOptions = {
  cache?: Runtime.Cache;
  enableSourceMaps?: boolean;
  fetch?: CustomFetch;
  injectGlobal?: Runtime.GlobalInjector;
  resolveBareModule?: BareModuleResolver;
  resolverHost?: ResolverHost;
  resolver?: Resolver;
};

export function createRuntime(options: CreateRuntimeOptions = {}) {
  return new Runtime({
    cache: options.cache,
    injectGlobal: options.injectGlobal,
    resolveBareModule: options.resolveBareModule || resolveBareModuleToIdentity,
    resolver: new Resolver(options.resolverHost || new ResolverHostUnpkg({ fetch: options.fetch }), {
      packageMain: ['browser', 'main'],
    }),
  });
}

const resolveBareModuleToIdentity: BareModuleResolver = (_runtime, _resolver, href) => href;
