import Module from 'module';

import { Resolver } from '@velcro/resolver';

import { BareModuleResolver } from './types';
import { Velcro } from './velcro';

export const resolveBareModuleWithNode: BareModuleResolver = (
  runtime: Velcro,
  _resolver: Resolver,
  href: string,
  parentHref?: string
) => {
  try {
    const contextualRequire = parentHref ? (Module.createRequireFromPath(parentHref) as NodeRequire) : require;
    const id = contextualRequire.resolve(href);
    const instance = contextualRequire(id);

    // If we short circuit System and inject the module right now, we will avoid calling the host's instantiate
    runtime.set(id, instance);

    return id;
  } catch (err) {
    throw new Error(`Error resolving bare module ${href}${parentHref ? ` from ${parentHref}` : ''}: ${err.message}`);
  }
};
