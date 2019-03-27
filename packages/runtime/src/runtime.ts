import { ResolverHostUnpkg } from '@velcro/resolver-host-unpkg';
import { Resolver, ResolverHost } from '@velcro/resolver';

import { SystemHostUnpkg } from './system_host';
import { System, SystemHost } from './system';

type CreateRuntimeOptions = {
  resolverHost?: ResolverHost;
  resolver?: Resolver;
  systemHost?: SystemHost;
};

export function createRuntime(options: CreateRuntimeOptions = {}) {
  const systemHost =
    options.systemHost ||
    new SystemHostUnpkg(
      options.resolver ||
        new Resolver(options.resolverHost || new ResolverHostUnpkg(), {
          packageMain: ['browser', 'main'],
        })
    );

  return new System(systemHost);
}
