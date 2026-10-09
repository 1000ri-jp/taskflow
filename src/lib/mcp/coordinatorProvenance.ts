import { createHash } from 'node:crypto';
import type { DocumentData, DocumentReference, Transaction, Query, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return canonical(value.toDate());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'apiChangedAt').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const coordinationFingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export interface TrustedMcpWrite { path: string; fingerprint: string | null; version: string | null; deleted: boolean }
/** Capture the exact committed documents, not the actor account shared with humans. */
export function trackMcpWrites(transaction: Transaction) {
  const read = new Map<string, DocumentData>(), written = new Map<string, DocumentData | null>();
  function merge(before: DocumentData, patch: DocumentData) {
    const next = { ...before };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'apiChangedAt') continue;
      const parts = key.split('.'); let target = next;
      for (const part of parts.slice(0, -1)) target = target[part] = { ...(target[part] ?? {}) };
      if (value?.constructor?.name === 'DeleteTransform') delete target[parts.at(-1)!];
      else target[parts.at(-1)!] = value;
    }
    return next;
  }
  const tx = new Proxy(transaction, { get(target, property) {
    if (property === 'get') return async (ref: DocumentReference | Query) => {
      const snapshot = await target.get(ref as DocumentReference) as DocumentSnapshot | QuerySnapshot;
      if ('docs' in snapshot) for (const doc of snapshot.docs) read.set(doc.ref.path, doc.data());
      else if ('ref' in snapshot && snapshot.exists) read.set(snapshot.ref.path, snapshot.data()!);
      return snapshot;
    };
    if (['create', 'set', 'update', 'delete'].includes(String(property))) return (ref: DocumentReference, data?: DocumentData, options?: unknown) => {
      if (property === 'delete') written.set(ref.path, null);
      else if (property === 'update' || options && typeof options === 'object' && 'merge' in options && options.merge) written.set(ref.path, merge(written.get(ref.path) ?? read.get(ref.path) ?? {}, data!));
      else written.set(ref.path, merge({}, data!));
      const fn = target[property as keyof Transaction] as (...args: unknown[]) => unknown;
      return fn.call(target, ref, ...(data === undefined ? [] : options === undefined ? [data] : [data, options]));
    };
    const value = target[property as keyof Transaction]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { tx, writes: (): TrustedMcpWrite[] => [...written].filter(([path]) => /^projects\/[^/]+\/tasks\/[^/]+(?:\/(comments|checklists|attachments)\/[^/]+)?$/.test(path)).map(([path, value]) => {
    const date = value?.updatedAt ?? value?.createdAt ?? value?.uploadedAt;
    const serialized = canonical(date);
    return { path, fingerprint: value ? coordinationFingerprint(value) : null, version: typeof serialized === 'string' ? serialized : null, deleted: value === null };
  }) };
}
