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

export interface ICache {
  get(segment: string, id: string): Promise<Serializable | undefined>;
  set(segment: string, id: string, value: Serializable): Promise<void>;
}

interface SerializableArray extends Array<Serializable> {}
interface SerializableObject extends Record<number | string, Serializable> {}

export type Serializable = boolean | number | null | string | undefined | SerializableArray | SerializableObject;
