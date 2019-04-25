import { openDB, DBSchema } from 'idb';

import { Runtime } from './runtime';

interface CacheSchema extends DBSchema {
  // [Velcro.CacheSegment.Instantiate]: {
  //   key: string;
  //   value: {
  //     code: string;
  //     href: string;
  //     requires: string[];
  //   };
  // };
  [Runtime.CacheSegment.Resolution]: {
    key: string;
    value: string;
  };
}

export function createCache(name: string): Runtime.Cache {
  const idbPromise = openDB<CacheSchema>(name, 1, {
    upgrade(db) {
      // db.createObjectStore(CacheSegment.Instantiate);
      db.createObjectStore(Runtime.CacheSegment.Resolution);
    },
  });

  return {
    delete(segment: Runtime.CacheSegment, key: string) {
      return idbPromise.then(idb => idb.delete(segment, key));
    },
    get(segment: Runtime.CacheSegment, key: string) {
      return idbPromise.then(idb => idb.get(segment, key));
    },
    set(segment: Runtime.CacheSegment, key: string, value: string) {
      return idbPromise.then(idb => idb.put(segment, value, key));
    },
  };
}
