// @vitest-environment node
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { listProjectTaskChanges } from './changeRepository';
import { changeTime, encodeChangeCursor } from './changeCursor';
const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));

// Actual installed SDK; only transport is replaced. No auth/network/production access.
// This proves request serialization, not backend retention or index availability.
it('serializes readTime, precise lower bound and document-ID continuation through the installed SDK', async () => {
  const db = new Firestore({ projectId: 'demo-taskflow-delta' }); fake.db = db;
  const at = Timestamp.fromMillis(Date.now() - 1000); const from = new Timestamp(at.seconds - 10, 123000); const after = new Timestamp(at.seconds - 5, 456000);
  const wire = db as unknown as { initializeIfNeeded: () => Promise<void>; requestStream: (method: string, bidi: boolean, request: Record<string, unknown>) => Promise<Readable> };
  wire.initializeIfNeeded = async () => {};
  let sent: Record<string, unknown> | undefined;
  wire.requestStream = async (method, bidi, request) => {
    expect(method).toBe('runQuery'); expect(bidi).toBe(false); sent = request;
    return Readable.from([{ readTime: { seconds: at.seconds, nanos: at.nanoseconds } }], { objectMode: true });
  };
  const cursor = encodeChangeCursor({ v: 1, project: 'p', kind: 'page', mode: 'delta', from: changeTime(from), at: changeTime(at), after: { id: 'task-b', at: changeTime(after) } });
  const result = await listProjectTaskChanges('p', cursor, 25);
  expect(result.tasks).toEqual([]);
  expect(sent).toMatchObject({ parent: 'projects/demo-taskflow-delta/databases/(default)/documents/projects/p', readTime: { seconds: String(at.seconds), nanos: at.nanoseconds },
    structuredQuery: { from: [{ collectionId: 'tasks' }], where: { fieldFilter: { field: { fieldPath: 'apiChangedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: { seconds: String(from.seconds), nanos: 123000 } } } },
      orderBy: [{ field: { fieldPath: 'apiChangedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 26 },
      startAt: { values: [{ timestampValue: { seconds: String(after.seconds), nanos: 456000 } }, { referenceValue: 'projects/demo-taskflow-delta/databases/(default)/documents/projects/p/tasks/task-b' }] } } });
  // Protobuf omits false (the default), which means exclusive startAfter.
  expect((sent?.structuredQuery as { startAt: { before?: boolean } }).startAt.before).not.toBe(true);
});
