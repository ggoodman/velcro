import { ResolverHostUnpkg, customFetch } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { SystemHostUnpkg } from './system_host';
import { System, SystemHost } from './system';
import { resolveBareModuleToUnpkg } from './unpkg';
import { BareModuleResolver } from './types';

type CreateRuntimeOptions = {
  fetch?: customFetch;
  injectGlobals?: boolean;
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
        shouldInjectGlobals: options.injectGlobals !== false,
        resolveBareModule: options.resolveBareModule || resolveBareModuleToUnpkg,
      }
    );

  return new System(systemHost);
}
