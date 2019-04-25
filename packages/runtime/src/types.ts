import { Resolver } from '@velcro/resolver';
import { Runtime } from './runtime';

export type Awaitable<T> = T | PromiseLike<T>;

export type BareModuleResolver = (
  runtime: Runtime,
  resolver: Resolver,
  href: string,
  parentHref?: string
) => Awaitable<string | undefined>;
