import { Resolver } from '@velcro/resolver';

import { System } from './system';

export type BareModuleResolver = (
  system: System,
  resolver: Resolver,
  href: string,
  parentHref?: string
) => string | PromiseLike<string>;

export interface ICache<TItem = any> {
  get(key: string): Promise<TItem | undefined>;
  set(key: string, value: TItem): Promise<void>;
}
