import { Resolver } from '@velcro/resolver';
import { Velcro } from './velcro';

export type Awaitable<T> = T | PromiseLike<T>;

export type BareModuleResolver = (
  runtime: Velcro,
  resolver: Resolver,
  href: string,
  parentHref?: string
) => Awaitable<string | undefined>;
