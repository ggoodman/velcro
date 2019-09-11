import { Resolver } from '@velcro/resolver';

export type Awaitable<T> = T | PromiseLike<T>;

export type BareModuleResolver = (
  resolver: Resolver,
  href: string,
  parentHref?: string
) => Awaitable<string | undefined>;
