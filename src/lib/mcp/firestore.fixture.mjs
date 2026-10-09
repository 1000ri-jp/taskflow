// Fictional Firestore adapter for deterministic transaction/query tests; no live access.
export function memoryFirestore() {
  const records = new Map();
  let tail = Promise.resolve();
  const snapshot = path => ({ id: path.split('/').at(-1), ref: document(path), exists: records.has(path),
    data: () => records.has(path) ? structuredClone(records.get(path)) : undefined });
  function document(path) {
    return { id: path.split('/').at(-1), path, collection: name => collection(path + '/' + name),
      get: async () => snapshot(path), set: async value => records.set(path, structuredClone(value)),
      create: async value => { if (records.has(path)) throw new Error('Already exists'); records.set(path, structuredClone(value)); },
      update: async value => { if (!records.has(path)) throw new Error('Missing'); records.set(path, { ...records.get(path), ...structuredClone(value) }); },
      delete: async () => records.delete(path) };
  }
  function collection(path, filters = [], orders = [], count = Infinity) {
    return { doc: id => document(path + '/' + id),
      where: (key, op, value) => collection(path, [...filters, [key, op, value]], orders, count),
      orderBy: key => collection(path, filters, [...orders, key], count),
      limit: n => collection(path, filters, orders, n),
      get: async () => {
        let rows = [...records].filter(([key, data]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') &&
          orders.every(field => data[field] !== undefined) && filters.every(([field, op, value]) =>
            op === '==' ? data[field] === value : op === '>' ? data[field] > value : op === '<=' ? data[field] <= value : false));
        rows.sort((a, b) => { for (const field of orders) { if (a[1][field] < b[1][field]) return -1; if (a[1][field] > b[1][field]) return 1; } return a[0].localeCompare(b[0]); });
        const docs = rows.slice(0, count).map(([key]) => snapshot(key)); return { docs, empty: !docs.length, size: docs.length };
      } };
  }
  async function runTransaction(fn) {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    const writes = [];
    try {
      const result = await fn({ get: ref => ref.get(),
        create: (ref, value) => writes.push(() => ref.create(value)),
        set: (ref, value) => writes.push(() => ref.set(value)),
        update: (ref, value) => writes.push(() => ref.update(value)) });
      for (const write of writes) await write();
      return result;
    } finally { release(); }
  }
  return { records, collection, runTransaction };
}
