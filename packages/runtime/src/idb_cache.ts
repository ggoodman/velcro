import { openDB, DBSchema } from 'idb';

import { Velcro } from './velcro';

interface CacheSchema extends DBSchema {
  // [Velcro.CacheSegment.Instantiate]: {
  //   key: string;
  //   value: {
  //     code: string;
  //     href: string;
  //     requires: string[];
  //   };
  // };
  [Velcro.CacheSegment.Resolution]: {
    key: string;
    value: string;
  };
}

export function createCache(name: string): Velcro.Cache {
  const idbPromise = openDB<CacheSchema>(name, 1, {
    upgrade(db) {
      // db.createObjectStore(CacheSegment.Instantiate);
      db.createObjectStore(Velcro.CacheSegment.Resolution);
    },
  });

  return {
    delete(segment: Velcro.CacheSegment, key: string) {
      return idbPromise.then(idb => idb.delete(segment, key));
    },
    get(segment: Velcro.CacheSegment, key: string) {
      return idbPromise.then(idb => idb.get(segment, key));
    },
    set(segment: Velcro.CacheSegment, key: string, value: string) {
      return idbPromise.then(idb => idb.put(segment, value, key));
    },
  };
}
