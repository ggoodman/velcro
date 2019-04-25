import { Resolver } from '@velcro/resolver';

export type Awaitable<T> = T | PromiseLike<T>;

export type BareModuleResolver = (
  resolver: Resolver,
  href: string,
  parentHref?: string
) => Awaitable<string | undefined>;

export type GlobalInjection = { spec: string; export?: string };
export type GlobalInjector = (globalName: string) => GlobalInjection | undefined;

export enum CacheSegment {
  Instantiate = 'instantiate',
  Resolve = 'resolve',
}

export interface CachedRegistrationRecord {
  code: string;
  href: string;
  requires: string[];
}

export interface ICache {
  delete(segment: CacheSegment, id: string): Promise<unknown>;
  get(segment: CacheSegment, id: string): Promise<CachedRegistrationRecord | string | undefined>;
  set(segment: CacheSegment, id: string, value: CachedRegistrationRecord | string): Promise<unknown>;
}

interface SerializableArray extends Array<Serializable> {}
interface SerializableObject extends Record<number | string, Serializable> {}

export type Serializable = boolean | number | null | string | undefined | SerializableArray | SerializableObject;
