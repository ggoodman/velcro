import { openDB, DBSchema } from 'idb';

import { Runtime } from './runtime';

type CachePredicate = (segment: Runtime.CacheSegment, key: string) => boolean;

interface CacheSchema extends DBSchema {
  [Runtime.CacheSegment.Registration]: {
    key: string;
    value: Runtime.LoadedModule;
  };
  [Runtime.CacheSegment.Resolution]: {
    key: string;
    value: string;
  };
}

export function createCache(name: string, predicate?: CachePredicate): Runtime.Cache {
  const idbPromise = openDB<CacheSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore(Runtime.CacheSegment.Registration);
      db.createObjectStore(Runtime.CacheSegment.Resolution);
    },
  });

  return {
    delete(segment: Runtime.CacheSegment, key: string) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.delete(segment, key));
      }
    },
    get(segment: Runtime.CacheSegment, key: string) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.get(segment, key));
      }
    },
    set(segment: Runtime.CacheSegment, key: string, value: string) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.put(segment, value, key));
      }
    },
  };
}
