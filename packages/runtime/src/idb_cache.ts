import { openDB, DBSchema } from 'idb';

import { Runtime } from './runtime';
import { log } from './util';

const IDB_CACHE_VERSION = 2;

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
  const idbPromise = openDB<CacheSchema>(name, IDB_CACHE_VERSION, {
    async upgrade(db, oldVersion, newVersion, tx) {
      log('Upgrading cache from version %s to %s', oldVersion, newVersion);

      switch (oldVersion) {
        case 0:
          db.createObjectStore(Runtime.CacheSegment.Registration);
          db.createObjectStore(Runtime.CacheSegment.Resolution);
        case 1:
          await tx.objectStore(Runtime.CacheSegment.Registration).clear();
          await tx.objectStore(Runtime.CacheSegment.Resolution).clear();
      }
    },
  });

  return {
    clear(segment?: Runtime.CacheSegment) {
      const clearSegments = segment ? [segment] : Object.values(Runtime.CacheSegment);

      return Promise.all(clearSegments.map(segment => idbPromise.then(idb => idb.clear(segment))));
    },
    delete(segment: Runtime.CacheSegment, key: string) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.delete(segment, key));
      }
    },
    get(segment: Runtime.CacheSegment, key: string) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.get(segment, key) as any);
      }
    },
    set(segment: Runtime.CacheSegment, key: string, value: any) {
      if (!predicate || predicate(segment, key)) {
        return idbPromise.then(idb => idb.put(segment, value, key));
      }
    },
  };
}
