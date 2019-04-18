import { Resolver } from '@velcro/resolver';

import { System } from './system';

export type BareModuleResolver = (
  system: System,
  resolver: Resolver,
  href: string,
  parentHref?: string
) => string | PromiseLike<string>;

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
  get(segment: CacheSegment, id: string): Promise<CachedRegistrationRecord | string | undefined>;
  set(segment: CacheSegment, id: string, value: CachedRegistrationRecord | string): Promise<unknown>;
}

interface SerializableArray extends Array<Serializable> {}
interface SerializableObject extends Record<number | string, Serializable> {}

export type Serializable = boolean | number | null | string | undefined | SerializableArray | SerializableObject;
