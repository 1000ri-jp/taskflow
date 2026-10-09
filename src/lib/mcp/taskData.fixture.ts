// Transaction fixture rejects reads after writes and preserves atomic rollback.
export function taskFirestore() {
  let records = new Map<string, Record<string, unknown>>();
  let failCommit = false;
  const clone = <T>(v: T): T => structuredClone(v);
  function patch(before: Record<string, unknown>, value: Record<string, unknown>) {
    const next = clone(before);
    for (const [key, item] of Object.entries(value)) {
      const keys = key.split('.'); let target = next;
      for (const part of keys.slice(0, -1)) target = target[part] as Record<string, unknown> ?? (target[part] = {}) as Record<string, unknown>;
      if (item && typeof item === 'object' && item.constructor.name === 'DeleteTransform') delete target[keys.at(-1)!];
      else target[keys.at(-1)!] = clone(item);
    }
    return next;
  }
  function doc(path: string) {
    return { path, id: path.split('/').at(-1)!, get parent() { return query(path.split('/').slice(0, -1).join('/')); },
      collection: (name: string) => query(`${path}/${name}`),
      get: async () => ({ id: path.split('/').at(-1)!, ref: doc(path), exists: records.has(path), data: () => records.has(path) ? clone(records.get(path)!) : undefined }) };
  }
  function query(path: string, filters: [string, string, unknown][] = [], maximum = Infinity, after = '') {
    return { path, get parent() { return doc(path.split('/').slice(0, -1).join('/')); }, doc: (id: string) => doc(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => query(path, [...filters, [field, op, value]], maximum, after),
      limit: (n: number) => query(path, filters, n, after), orderBy: () => query(path, filters, maximum, after), startAfter: (id: string) => query(path, filters, maximum, id),
      get: async (): Promise<{ docs: { id: string; ref: unknown; exists: boolean; data: () => Record<string, unknown> | undefined }[]; size: number; empty: boolean }> => {
        const paths = [...records.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && key.split('/').at(-1)! > after && filters.every(([field, op, value]) => op === 'array-contains' ? Array.isArray(records.get(key)?.[field]) && (records.get(key)![field] as unknown[]).includes(value) : records.get(key)?.[field] === value)).sort().slice(0, maximum);
        const docs = await Promise.all(paths.map(p => doc(p).get())); return { docs, size: docs.length, empty: !docs.length };
      } };
  }
  const db = { doc, collection: query, runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    const writes: { kind: string; path: string; value?: Record<string, unknown> }[] = [];
    const result = await fn({ get: (ref: ReturnType<typeof doc> | ReturnType<typeof query>) => { if (writes.length) throw new Error('read after write'); return ref.get(); },
      create: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) => writes.push({ kind: 'create', path: ref.path, value }),
      set: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) => writes.push({ kind: 'set', path: ref.path, value }),
      update: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) => writes.push({ kind: 'update', path: ref.path, value }),
      delete: (ref: ReturnType<typeof doc>) => writes.push({ kind: 'delete', path: ref.path }) });
    if (failCommit) throw new Error('commit unavailable');
    const next = new Map(records);
    for (const write of writes) {
      if (write.kind === 'create' && next.has(write.path) || write.kind === 'update' && !next.has(write.path)) throw new Error('invalid write');
      if (write.kind === 'delete') next.delete(write.path);
      else next.set(write.path, write.kind === 'update' ? patch(next.get(write.path)!, write.value!) : clone(write.value!));
    }
    records = next; return result;
  } };
  return { db, get records() { return records; }, fail: (value: boolean) => { failCommit = value; } };
}
