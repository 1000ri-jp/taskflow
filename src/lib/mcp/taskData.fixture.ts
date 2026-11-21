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
  type Order = string | { segments?: string[] };
  const fieldOf = (order: Order) => typeof order === 'string' ? order : '__name__';
  const comparable = (v: unknown) => v instanceof Date ? v.getTime() : v as number | string;
  const matches = (data: Record<string, unknown> | undefined, [field, op, value]: [string, string, unknown]) => {
    const actual = data?.[field];
    if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
    if (op === '>=' || op === '<') return actual != null && (op === '>=' ? comparable(actual) >= comparable(value) : comparable(actual) < comparable(value));
    return actual === value;
  };
  // Orders other than document ID sort by that field, then by document ID, like Firestore.
  function query(path: string, filters: [string, string, unknown][] = [], maximum = Infinity, after: unknown[] = [], orders: Order[] = []) {
    const fields = orders.map(fieldOf).filter(field => field !== '__name__');
    const key = (docPath: string) => [...fields.map(field => comparable(records.get(docPath)?.[field])), docPath.split('/').at(-1)!];
    const compare = (a: unknown[], b: unknown[]) => { for (let i = 0; i < a.length; i++) { if ((a[i] as number) < (b[i] as number)) return -1; if ((a[i] as number) > (b[i] as number)) return 1; } return 0; };
    return { path, get parent() { return doc(path.split('/').slice(0, -1).join('/')); }, doc: (id: string) => doc(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => query(path, [...filters, [field, op, value]], maximum, after, orders),
      limit: (n: number) => query(path, filters, n, after, orders), orderBy: (order: Order) => query(path, filters, maximum, after, [...orders, order]),
      startAfter: (...values: unknown[]) => query(path, filters, maximum, values, orders),
      get: async (): Promise<{ docs: { id: string; ref: unknown; exists: boolean; data: () => Record<string, unknown> | undefined }[]; size: number; empty: boolean }> => {
        const position = after.length ? [...after.slice(0, -1).map(comparable), after.at(-1)] : null;
        const paths = [...records.keys()].filter(item => item.startsWith(path + '/') && !item.slice(path.length + 1).includes('/') && filters.every(filter => matches(records.get(item), filter)) && fields.every(field => records.get(item)?.[field] !== undefined))
          .sort((a, b) => compare(key(a), key(b))).filter(item => !position || compare(key(item), position) > 0).slice(0, maximum);
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
