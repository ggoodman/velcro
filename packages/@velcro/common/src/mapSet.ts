export class MapSet<K, V> {
  private readonly _data = new Map<K, Set<V>>();

  get size() {
    return this._data.size;
  }

  add(key: K, value: V) {
    let values = this._data.get(key);

    if (!values) {
      values = new Set();
      this._data.set(key, values);
    }

    values.add(value);

    return this;
  }

  delete(key: K, value: V) {
    const values = this._data.get(key);

    if (values) {
      const ret = values.delete(value);

      if (!values.size) {
        this._data.delete(key);
      }

      return ret;
    }

    return false;
  }

  get(key: K) {
    return this._data.get(key);
  }

  has(key: K) {
    return this._data.has(key);
  }

  hasValue(key: K, value: V) {
    const values = this._data.get(key);

    return values ? values.has(value) : false;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, values] of this._data.entries()) {
      for (const value of values) {
        yield [key, value];
      }
    }
  }

  *values(): IterableIterator<V> {
    for (const values of this._data.values()) {
      yield* values.values();
    }
  }
}
