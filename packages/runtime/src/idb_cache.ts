import { openDB, DBSchema } from 'idb';

import { ICache, CacheSegment, CachedRegistrationRecord } from './types';

interface CacheSchema extends DBSchema {
  [CacheSegment.Instantiate]: {
    key: string;
    value: {
      code: string;
      href: string;
      requires: string[];
    };
  };
  [CacheSegment.Resolve]: {
    key: string;
    value: string;
  };
}

export function createCache(name: string): ICache {
  const idbPromise = openDB<CacheSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore(CacheSegment.Instantiate);
      db.createObjectStore(CacheSegment.Resolve);
    },
  });

  return {
    delete(segment: CacheSegment, key: string) {
      return idbPromise.then(idb => idb.delete(segment, key));
    },
    get(segment: CacheSegment, key: string) {
      return idbPromise.then(idb => idb.get(segment, key));
    },
    set(segment: CacheSegment, key: string, value: string | CachedRegistrationRecord) {
      return idbPromise.then(idb => idb.put(segment, value, key));
    },
  };
}
