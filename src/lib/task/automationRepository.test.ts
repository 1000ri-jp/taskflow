import {recordPurchaseReport} from './automationRepository';
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { automationHash, changeAutomationReminder, readAutomation, runAutomationBatch, runTaskAutomation, saveAutomationRule, saveCompletionPolicy, undoAutomation } from './automationRepository';
import type { AutomationState, TaskEvidenceRule } from './automationTypes';
import { emptyGoogleSource, emptyGoogleWorkspace, type GoogleSource } from '@/lib/google/workspace/types';

type Data = Record<string, unknown>;
const fake = vi.hoisted(() => ({ db: null as unknown, configured: true, refresh: vi.fn(), failRead: null as string | null, failCommit: false, readsAfterWrite: 0 }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));
vi.mock('@/lib/google/workspace/security', () => ({ isGoogleConfigured: () => fake.configured }));
vi.mock('@/lib/google/workspace/oauth', () => ({ connectionRef: (uid: string) => (fake.db as { doc(path: string): unknown }).doc(`connections/${uid}`), cacheRef: (uid: string) => (fake.db as { doc(path: string): unknown }).doc(`caches/${uid}`) }));
vi.mock('@/lib/google/workspace/repository', () => ({ refreshWorkspace: fake.refresh, workspaceView: (_connection: unknown, cache?: { source?: GoogleSource }) => ({ ...emptyGoogleWorkspace(), sources: { ...emptyGoogleWorkspace().sources, gmail: cache?.source ?? emptyGoogleSource() } }) }));
let documents: Map<string, Data>;
let serial: Promise<unknown>;
let sequence = 0;
class Ref {
  constructor(public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  get parent(): Query { return new Query(this.path.split('/').slice(0, -1).join('/')); }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async get() {
    if (fake.failRead === this.path) throw new Error('Synthetic read failure');
    const value = documents.get(this.path);
    return { id: this.id, ref: this, exists: value !== undefined, data: () => value ? structuredClone(value) : undefined };
  }
}
class Query {
  filters: [string, unknown][] = []; maximum = Infinity; after: string | null = null;
  constructor(public path: string, public group = false) {}
  get parent() { return new Ref(this.path.split('/').slice(0, -1).join('/')); }
  doc(id = `generated-${++sequence}`) { return new Ref(`${this.path}/${id}`); }
  where(field: string, _operator: string, value: unknown) { this.filters.push([field, value]); return this; }
  limit(value: number) { this.maximum = value; return this; }
  orderBy() { return this; }
  startAfter(ref: Ref) { this.after = ref.path; return this; }
  async get() {
    if (fake.failRead === this.path) throw new Error('Synthetic query failure');
    const paths = [...documents.keys()].filter(path => this.group ? path.split('/').at(-2) === this.path : path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1)
      .filter(path => this.filters.every(([field, value]) => documents.get(path)![field] === value) && (!this.after || path > this.after)).sort().slice(0, this.maximum);
    const docs = await Promise.all(paths.map(path => new Ref(path).get()));
    return { docs, size: docs.length, empty: !docs.length };
  }
}
const now = '2026-09-12T03:00:00.000Z';
const rule = (changes: Partial<TaskEvidenceRule> = {}): TaskEvidenceRule => ({ projectId: 'p', taskId: 'self', enabled: true, subject: '展示会', period: '2026', person: '本人', sender: 'tickets@example.test', criterion: 'purchase', allowExpectedDate: true, sources: ['gmail'], ...changes });
const taskPath = (id = 'self') => `projects/p/tasks/${id}`;
const state = (uid = 'u') => documents.get(`users/${uid}/secretary/task-automation`) as unknown as AutomationState;
const currentTask = (id = 'self') => documents.get(taskPath(id))!;
const parentUpdatedAt = () => (currentTask('parent').updatedAt as Date).toISOString();
const activities = () => [...documents].filter(([path]) => path.startsWith('projects/p/activityLogs/'));
const notices = () => [...documents].filter(([path]) => path.startsWith('notifications/'));
function mail(text = '展示会 2026 本人 購入完了。', id = 'm1', at = '2026-09-12T01:00:00.000Z') {
  return { id, title: '購入のお知らせ', text, at, url: `https://mail.google.com/mail/#all/${id}`, sourceName: 'チケット窓口 <tickets@example.test>' };
}
function gmail(items = [mail()], changes: Partial<GoogleSource> = {}) {
  documents.set('caches/u', { source: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now, items, ...changes } });
}
function member(uid: string, role = 'editor') {
  documents.set(`users/${uid}`, { displayName: uid });
  documents.set(`projects/p/members/${uid}`, { userId: uid, role });
}
function parentFixture() {
  documents.set(taskPath('parent'), { ...currentTask(), title: '全員分の購入', assigneeIds: ['u'], dueDate: new Date('2026-09-13T03:00:00Z') });
  currentTask().parentTaskId = 'parent';
  documents.set(taskPath('peer'), { ...currentTask(), title: '同僚分の購入', assigneeIds: ['v'], parentTaskId: 'parent' });
}
const policy = { condition: '必要な全員が購入と支払を完了した', required: [{ taskId: 'self', assigneeId: 'u' }, { taskId: 'peer', assigneeId: 'v' }] };

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  documents = new Map(); serial = Promise.resolve(); sequence = 0; fake.configured = true; fake.failRead = null; fake.failCommit = false; fake.readsAfterWrite = 0;
  fake.refresh.mockResolvedValue(undefined);
  fake.db = {
    doc: (path: string) => new Ref(path), collection: (path: string) => new Query(path), collectionGroup: (path: string) => new Query(path, true),
    runTransaction: (run: (tx: unknown) => Promise<unknown>) => {
      const operation = serial.then(async () => {
        const writes: { kind: 'set' | 'update' | 'create' | 'delete'; ref: Ref; value?: Data }[] = [];
        const append = (kind: 'set' | 'update' | 'create' | 'delete', ref: Ref, value?: Data) => writes.push({ kind, ref, value: value ? structuredClone(value) : undefined });
        const value = await run({ get: (ref: Ref | Query) => { if (writes.length) { fake.readsAfterWrite++; throw new Error('Firestore requires all reads before writes'); } return ref.get(); },
          set: (ref: Ref, value: Data) => append('set', ref, value), update: (ref: Ref, value: Data) => append('update', ref, value), create: (ref: Ref, value: Data) => append('create', ref, value), delete: (ref: Ref) => append('delete', ref) });
        if (fake.failCommit && writes.length) { fake.failCommit = false; throw new Error('Synthetic commit failure'); }
        for (const write of writes) {
          if (write.kind === 'delete') documents.delete(write.ref.path);
          else if (write.kind === 'update') { if (!documents.has(write.ref.path)) throw new Error('Update of missing document'); documents.set(write.ref.path, { ...documents.get(write.ref.path), ...write.value }); }
          else { if (write.kind === 'create' && documents.has(write.ref.path)) throw new Error('Create conflict'); documents.set(write.ref.path, write.value!); }
        }
        return value;
      });
      serial = operation.catch(() => undefined); return operation;
    },
  };
  documents.set('projects/p', { name: '架空の展示会', memberIds: ['u', 'v'], isArchived: false }); member('u'); member('v');
  documents.set(taskPath(), { projectId: 'p', title: '本人のチケット購入', description: '展示会 2026 本人 購入と支払完了', assigneeIds: ['u'], dependsOnTaskIds: [], isCompleted: false, completedAt: null, isArchived: false, isAbandoned: false, dueDate: null, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z') });
  documents.set('connections/u', { enabled: ['gmail'], epoch: 'e1' }); gmail();
});
afterEach(() => { expect(fake.readsAfterWrite).toBe(0); vi.useRealTimers(); });

describe('task automation transactional evidence', () => {
  it('applies a permitted purchase once, records private provenance, and never copies mail into shared history', async () => {
    gmail([mail('展示会 2026 本人 購入完了。 PRIVATE-MAIL-DETAIL')]);
    await saveAutomationRule('u', rule(), 0); const count = activities().length;
    const first = await runTaskAutomation('u', false);
    expect(first.errors).toEqual([]); expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(1);
    expect(state().grants[0].records[0].sourceUrl).toContain('/#all/m1'); expect(activities()).toHaveLength(count + 1);
    expect(JSON.stringify([...documents].filter(([path]) => path.startsWith('projects/')))).not.toMatch(/PRIVATE-MAIL-DETAIL|mail.google.com|m1/);
    const before = structuredClone(currentTask()); await runTaskAutomation('u', false);
    expect(state().grants[0].records).toHaveLength(1); expect(activities()).toHaveLength(count + 1); expect(currentTask()).toEqual(before);
  });
  it.each(['partial', 'error', 'pending', 'stale'] as const)('keeps prior completion while %s Gmail coverage is unavailable', async status => {
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    gmail([mail('展示会 2026 本人 キャンセル完了。', 'cancel', '2026-09-12T02:00:00.000Z')], status === 'stale' ? { fetchedAt: '2026-09-10T00:00:00Z' } : { status });
    const result = await runTaskAutomation('u', false);
    expect(result.errors).toEqual([]); expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(1);
    expect(state().grants[0].check).toBe(status === 'partial' ? 'partial' : 'unavailable');
  });
  it.each(['disabled', 'epoch', 'membership', 'ai_scope'] as const)('stops after %s revocation without removing confirmed work', async reason => {
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    if (reason === 'disabled') documents.get('connections/u')!.enabled = [];
    if (reason === 'epoch') documents.get('connections/u')!.epoch = 'another-account';
    if (reason === 'membership') documents.get('projects/p')!.memberIds = ['v'];
    if (reason === 'ai_scope') documents.set('users/u/settings/aiSettings', { allowedProjectIds: [] });
    await runTaskAutomation('u', false);
    expect(state().grants[0].check).toBe('revoked'); expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(1);
    if (reason === 'membership') expect((await readAutomation('u')).grants).toEqual([]);
  });
  it.each(['person', 'period', 'subject', 'sender', 'before-task', 'future'] as const)('ignores a clear positive for the wrong %s', async reason => {
    const message = mail();
    if (reason === 'person') message.text = '展示会 2026 同僚 購入完了。';
    if (reason === 'period') message.text = '展示会 2025 本人 購入完了。';
    if (reason === 'subject') message.text = '別イベント 2026 本人 購入完了。';
    if (reason === 'sender') message.sourceName = 'attacker@example.test';
    if (reason === 'before-task') message.at = '2026-08-01T00:00:00Z';
    if (reason === 'future') message.at = '2026-10-01T00:00:00Z';
    gmail([message]); await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].records).toEqual([]); expect(state().grants[0].check).toBe('unconfirmed');
  });
  it('distinguishes application, order, shipment and expected arrival from payment or receipt', async () => {
    gmail([mail('展示会 2026 本人 申込受付。', 'apply', '2026-09-12T00:00:00.000Z'), mail('展示会 2026 本人 注文完了。', 'ordered', '2026-09-12T00:30:00.000Z'), mail('展示会 2026 本人 発送済み。', 'sent', '2026-09-12T01:00:00.000Z'), mail('展示会 2026 本人 到着予定：2026年9月15日', 'expected', '2026-09-12T02:00:00.000Z')]);
    await saveAutomationRule('u', rule({ criterion: 'receipt' }), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); expect(currentTask().dueDate).toEqual(new Date('2026-09-15T03:00:00Z'));
    expect(state().grants[0].records.map(record => record.stage)).toEqual(['application', 'ordered', 'shipped', 'expected']);
    gmail([mail('展示会 2026 本人 受取完了。', 'received', '2026-09-12T02:30:00.000Z')]); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(true);
  });
  it('reopens only completion owned by this grant and handles a purchase plus later cancellation in the same run', async () => {
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    gmail([mail(), mail('展示会 2026 本人 返金完了。', 'cancel', '2026-09-12T02:00:00.000Z')]); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].ownedCompletion).toBe(false);
    expect(state().grants[0].records.map(record => record.stage)).toEqual(['paid', 'refunded']);
    currentTask().isCompleted = true; currentTask().completedAt = new Date(now);
    await saveAutomationRule('u', rule({ taskId: 'self' }), state().revision);
    gmail([mail('展示会 2026 本人 キャンセル完了。', 'cancel-2', '2026-09-12T02:30:00.000Z')]); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(true);
  });
  it('does not leave a purchase complete when a newer cancellation is in the same acquired batch', async () => {
    gmail([mail(), mail('展示会 2026 本人 キャンセル完了。', 'cancel', '2026-09-12T02:00:00.000Z')]);
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].records.map(record => record.stage)).toEqual(['paid', 'cancelled']);
  });
  it('reports a failed comment query as unavailable work, preserving prior state and receipts', async () => {
    await saveAutomationRule('u', rule({ sources: ['comment'], sender: '' }), 0);
    fake.failRead = `${taskPath()}/comments`;
    expect((await runTaskAutomation('u', false)).errors).toHaveLength(1);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].records).toEqual([]);
  });
  it('preserves subsequent edits and blocks cancellation and undo against a changed version', async () => {
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    currentTask().title = '別の人が更新した件名'; currentTask().updatedAt = new Date('2026-09-12T02:59:00Z');
    gmail([mail('展示会 2026 本人 キャンセル完了。', 'cancel', '2026-09-12T02:00:00.000Z')]); await runTaskAutomation('u', false);
    expect(state().grants[0].check).toBe('conflict'); expect(currentTask().isCompleted).toBe(true);
    await expect(undoAutomation('u', 'p', 'self', state().grants[0].records[0].id, state().revision)).rejects.toMatchObject({ status: 409 });
    expect(currentTask().title).toBe('別の人が更新した件名');
  });
  it('uses only the granting person’s own comments and does not apply a truncated comment read', async () => {
    documents.set(`${taskPath()}/comments/other`, { authorId: 'v', content: '展示会 2026 本人 購入完了。', createdAt: new Date('2026-09-12T01:00:00Z') });
    await saveAutomationRule('u', rule({ sources: ['comment'], sender: '' }), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false);
    for (let index = 0; index < 201; index++) documents.set(`${taskPath()}/comments/c${index}`, { authorId: 'u', content: '展示会 2026 本人 購入完了。', createdAt: new Date('2026-09-12T02:00:00Z') });
    await runTaskAutomation('u', false); expect(state().grants[0].check).toBe('partial'); expect(currentTask().isCompleted).toBe(false);
  });
  it('keeps task and private records atomic when a commit fails, then retries once', async () => {
    await saveAutomationRule('u', rule(), 0); fake.failCommit = true;
    expect((await runTaskAutomation('u', false)).errors).toHaveLength(1);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].records).toEqual([]);
    await runTaskAutomation('u', false); expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(1);
  });
});

describe('applied evidence revisions', () => {
  it('pauses on a same-comment correction, retains completed work, and resumes only from a new explicit fact', async () => {
    const path = `${taskPath()}/comments/proof`;
    documents.set(path, { authorId: 'u', content: '展示会 2026 本人 購入完了。', createdAt: new Date('2026-09-12T01:00:00Z'), updatedAt: new Date('2026-09-12T01:00:00Z') });
    await saveAutomationRule('u', rule({ sources: ['comment'] }), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records[0].ruleVersion).toBeTruthy();
    documents.get(path)!.content = '展示会 2026 本人 訂正：購入はまだ確認できません。'; documents.get(path)!.updatedAt = new Date('2026-09-12T02:00:00Z');
    await runTaskAutomation('u', false);
    expect(state().grants[0].check).toBe('conflict'); expect(state().grants[0].records).toHaveLength(1); expect(currentTask().isCompleted).toBe(true);
    documents.get(path)!.content = '展示会 2026 本人 キャンセル完了。'; documents.get(path)!.updatedAt = new Date('2026-09-12T02:30:00Z');
    await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); expect(state().grants[0].records).toHaveLength(2);
  });
  it('does not confuse an absent retained source with an explicit correction of the same source', async () => {
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false); gmail([]);
    await runTaskAutomation('u', false);
    expect(state().grants[0].check).toBe('confirmed'); expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(1);
  });
  it('retains the audit but evaluates the same source again against a newly chosen completion criterion', async () => {
    gmail([mail('展示会 2026 本人 受取完了。')]);
    await saveAutomationRule('u', rule(), 0); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(false); const original = state().grants[0].records[0];
    await saveAutomationRule('u', rule({ criterion: 'receipt' }), state().revision); await runTaskAutomation('u', false);
    expect(currentTask().isCompleted).toBe(true); expect(state().grants[0].records).toHaveLength(2);
    expect(state().grants[0].records[0]).toEqual(original); expect(state().grants[0].records[1].ruleVersion).not.toBe(original.ruleVersion);
  });
});

describe('authorized all-child conditions and deadline reminders', () => {
  it('completes only when every required named child completes, and reopens only its owned parent', async () => {
    parentFixture(); await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt());
    currentTask().isCompleted = true; await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false);
    currentTask('peer').isCompleted = true; await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(true);
    expect(currentTask('parent').completionPolicy).toMatchObject({ completedByAutomation: true });
    currentTask('peer').isCompleted = false; await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false);
    currentTask('peer').isCompleted = true; await runTaskAutomation('u', false);
    currentTask('parent').title = '本人が後から変更'; currentTask('peer').isCompleted = false;
    await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(true);
  });
  it('does not count reassigned, removed or cancelled required children as fulfilled', async () => {
    parentFixture(); await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt());
    currentTask().isCompleted = true; currentTask('peer').isCompleted = true; currentTask('peer').assigneeIds = ['someone'];
    await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false);
    currentTask('peer').assigneeIds = ['v']; currentTask('peer').isAbandoned = true;
    await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false);
    documents.delete(taskPath('peer')); await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false);
  });
  it('deduplicates reminders, retains unknown acquisition, snoozes, and clears notifications on due change or completion', async () => {
    parentFixture(); currentTask('peer').automation = { check: 'unavailable' };
    await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt()); expect(notices()).toHaveLength(1);
    const original = structuredClone(notices()[0][1]);
    expect(JSON.stringify(original)).toContain('unavailable'); expect(JSON.stringify(original)).not.toContain('未購入');
    await runTaskAutomation('u', false); expect(notices()[0][1]).toEqual(original);
    await changeAutomationReminder('u', 'p', 'parent', '2026-09-12T06:00:00Z'); expect(notices()).toEqual([]);
    await runTaskAutomation('u', false); expect(notices()).toEqual([]);
    vi.setSystemTime(new Date('2026-09-12T07:00:00Z')); await runTaskAutomation('u', false); expect(notices()).toHaveLength(1);
    currentTask('parent').dueDate = new Date('2026-09-20T03:00:00Z'); await runTaskAutomation('u', false);
    expect(notices()).toEqual([]); expect(state().reminders[0].snoozedUntil).toBeNull();
    currentTask('parent').dueDate = new Date('2026-09-13T03:00:00Z'); await runTaskAutomation('u', false); expect(notices()).toHaveLength(1);
    currentTask().isCompleted = true; currentTask('peer').isCompleted = true; await runTaskAutomation('u', false); expect(notices()).toEqual([]);
  });
  it('cleans up reminder and notification when the parent is cancelled or its explicit policy disappears', async () => {
    parentFixture(); await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt()); expect(notices()).toHaveLength(1);
    currentTask('parent').isAbandoned = true; await runTaskAutomation('u', false); expect(notices()).toEqual([]); expect(state().reminders).toEqual([]);
  });
  it('removes an already created notification when the owner disables the all-child policy', async () => {
    parentFixture(); await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt()); expect(notices()).toHaveLength(1);
    await saveCompletionPolicy('u', 'p', 'parent', null, parentUpdatedAt());
    expect(state().reminders).toEqual([]); expect(currentTask('parent').completionPolicy).toBeNull(); expect(notices()).toEqual([]);
  });
  it('never completes an ordinary parent merely because its children have completed', async () => {
    parentFixture(); currentTask().isCompleted = true; currentTask('peer').isCompleted = true;
    await runTaskAutomation('u', false); expect(currentTask('parent').isCompleted).toBe(false); expect(notices()).toEqual([]);
  });
  it('rejects stale grant revisions, viewer writes and mismatched required members without changing tasks', async () => {
    await saveAutomationRule('u', rule(), 0);
    await expect(saveAutomationRule('u', rule(), 0)).rejects.toMatchObject({ status: 409 });
    member('u', 'viewer'); await expect(saveAutomationRule('u', rule(), state().revision)).rejects.toMatchObject({ status: 403 });
    member('u'); parentFixture(); await expect(saveCompletionPolicy('u', 'p', 'parent', { ...policy, required: [{ taskId: 'peer', assigneeId: 'u' }] }, parentUpdatedAt())).rejects.toThrow('一致しません');
    expect(currentTask('parent').completionPolicy).toBeUndefined();
  });
  it('advances only persisted authorized state documents and validates batch cursors', async () => {
    await saveAutomationRule('u', rule(), 0);
    documents.set('users/v/secretary/state', { automationEnabled: true });
    const result = await runAutomationBatch();
    expect(result).toMatchObject({ checked: 2, failed: 0, nextCursor: null }); expect(currentTask().isCompleted).toBe(true);
    await expect(runAutomationBatch('projects/p/tasks/self')).rejects.toThrow('カーソル');
    expect(automationHash(['u', 'p', 'parent'])).toHaveLength(64);
  });
  it('rejects stale parent edits and stale policy removals without replacing another editor’s condition', async () => {
    parentFixture(); const expected = parentUpdatedAt();
    await saveCompletionPolicy('u', 'p', 'parent', policy, expected);
    const saved = structuredClone(currentTask('parent')); const activityCount = activities().length;
    await expect(saveCompletionPolicy('v', 'p', 'parent', { ...policy, condition: '古い画面の条件' }, expected)).rejects.toMatchObject({ status: 409 });
    await expect(saveCompletionPolicy('u', 'p', 'parent', null, expected)).rejects.toMatchObject({ status: 409 });
    expect(currentTask('parent')).toEqual(saved); expect(activities()).toHaveLength(activityCount);
    await expect(saveCompletionPolicy('u', 'p', 'parent', policy, '')).rejects.toMatchObject({ status: 409 });
  });
  it.each(['membership', 'viewer', 'ai_scope'] as const)('removes only the owner’s stale reminder after %s permission loss and retains shared work', async reason => {
    parentFixture(); await saveCompletionPolicy('u', 'p', 'parent', policy, parentUpdatedAt());
    const ownedNotification = notices()[0][0]; const before = structuredClone(currentTask('parent'));
    documents.set('notifications/other-owner', { userId: 'v', title: '他の人の通知' });
    if (reason === 'membership') documents.get('projects/p')!.memberIds = ['v'];
    if (reason === 'viewer') member('u', 'viewer');
    if (reason === 'ai_scope') documents.set('users/u/settings/aiSettings', { allowedProjectIds: [] });
    await runTaskAutomation('u', false);
    expect(documents.has(ownedNotification)).toBe(false); expect(documents.has('notifications/other-owner')).toBe(true);
    expect(currentTask('parent')).toEqual(before); expect(state().reminders[0].notifiedSignature).toBeNull();
    await runTaskAutomation('u', false); expect(documents.has(ownedNotification)).toBe(false);
  });

});

describe('authorized ETA schedule and undo',()=>{
  function existingSchedule(){
    Object.assign(currentTask(),{startDate:new Date('2026-09-10T00:00:00+09:00'),dueDate:new Date('2026-09-20T03:00:00Z'),durationDays:11,isDueDateFixed:false});
  }
  it('writes a fixed delivery date and matching duration, with the original scheduling fields in audit',async()=>{
    existingSchedule();gmail([mail('展示会 2026 本人 到着予定：2026年9月15日。')]);
    await saveAutomationRule('u',rule({criterion:'receipt'}),0);await runTaskAutomation('u',false);
    expect(currentTask()).toMatchObject({isCompleted:false,startDate:new Date('2026-09-10T00:00:00+09:00'),dueDate:new Date('2026-09-15T03:00:00Z'),isDueDateFixed:true,durationDays:6});
    expect(state().grants[0].records[0]).toMatchObject({before:{isDueDateFixed:false,durationDays:11},after:{isDueDateFixed:true,durationDays:6}});
  });
  it('restores the original fixed flag and duration together with the due date on undo',async()=>{
    existingSchedule();gmail([mail('展示会 2026 本人 到着予定：2026年9月15日。')]);
    await saveAutomationRule('u',rule({criterion:'receipt'}),0);await runTaskAutomation('u',false);
    await undoAutomation('u','p','self',state().grants[0].records[0].id,state().revision);
    expect(currentTask()).toMatchObject({dueDate:new Date('2026-09-20T03:00:00Z'),isDueDateFixed:false,durationDays:11});
  });
  it('preserves work and records an explicit conflict when the expected day is before the registered start',async()=>{
    existingSchedule();const before=structuredClone(currentTask());gmail([mail('展示会 2026 本人 到着予定：2026年9月9日。')]);
    await saveAutomationRule('u',rule({criterion:'receipt'}),0);await runTaskAutomation('u',false);
    expect(currentTask()).toMatchObject({startDate:before.startDate,dueDate:before.dueDate,isDueDateFixed:before.isDueDateFixed,durationDays:before.durationDays,isCompleted:false});
    expect(state().grants[0]).toMatchObject({check:'conflict',stage:null,reason:expect.stringContaining('開始日より前'),records:[]});
    expect(currentTask().automation).toMatchObject({check:'conflict',expectedDate:null});
  });
  it('does not change the existing schedule when expected-date updates were not granted',async()=>{
    existingSchedule();gmail([mail('展示会 2026 本人 到着予定：2026年9月15日。')]);
    await saveAutomationRule('u',rule({allowExpectedDate:false}),0);await runTaskAutomation('u',false);
    expect(currentTask()).toMatchObject({dueDate:new Date('2026-09-20T03:00:00Z'),isDueDateFixed:false,durationDays:11});
  });
  it('reads old records without schedule snapshots and avoids guessing schedule values during their undo',async()=>{
    existingSchedule();await saveAutomationRule('u',rule(),0);await runTaskAutomation('u',false);
    const record=state().grants[0].records[0];delete record.before.isDueDateFixed;delete record.before.durationDays;
    await undoAutomation('u','p','self',record.id,state().revision);
    expect(currentTask()).toMatchObject({isCompleted:false,isDueDateFixed:false,durationDays:11});
  });
});

it('rejects new subtask automation and preserves an older grant without changing the subtask',async()=>{
 gmail([mail()]);await saveAutomationRule('u',rule(),0);const beforeGrant=structuredClone(state().grants[0]);parentFixture();const before=structuredClone([...documents]);
 await expect(saveAutomationRule('u',rule(),state().revision)).rejects.toThrow('親タスク');expect([...documents]).toEqual(before);
 const task=structuredClone(currentTask());await runTaskAutomation('u',false);expect(currentTask()).toEqual(task);expect(state().grants[0].records).toEqual(beforeGrant.records);expect(state().grants[0].reason).toContain('親タスク');
});
it('does not use a completed subtask after it has moved away from a required parent',async()=>{
 parentFixture();await saveCompletionPolicy('u','p','parent',policy,parentUpdatedAt());currentTask().isCompleted=true;currentTask('peer').isCompleted=true;currentTask('peer').parentTaskId='another-parent';await runTaskAutomation('u',false);expect(currentTask('parent').isCompleted).toBe(false);
});


describe('purchase report and order tracking',()=>{
 const report=()=>({id:'report-one',projectId:'p',taskId:'self',track:true,attachment:null,report:{merchant:'マヒトデザイン',orderNumber:'ORDER-1234',item:'名刺',orderedOn:'2026-09-11',stage:'ordered',expectedDate:null,sourceText:'マヒトデザインで名刺を注文完了。注文番号ORDER-1234',question:''}});
 it('records once on the parent, tracks shipping and ETA, never changes the deadline or completes the task',async()=>{
  const due=new Date('2026-09-14T00:00:00Z');currentTask().dueDate=due;currentTask().assigneeIds=['u','v'];
  await recordPurchaseReport('u',report());await recordPurchaseReport('u',report());
  expect(state().grants).toHaveLength(1);expect(activities()).toHaveLength(1);expect(notices()).toHaveLength(0);
  expect(documents.get(taskPath()+'/comments/report-one')?.content).toContain('ORDER-1234');
  gmail([mail('マヒトデザイン 注文番号 ORDER-1234。発送しました。お届け予定日：2026/9/15','shipping')]);
  expect((await runTaskAutomation('u',false)).errors).toEqual([]);
  expect(currentTask().automation).toMatchObject({merchant:'マヒトデザイン',stage:'shipped',expectedDate:'2026-09-15',sourceCommentId:'report-one'});
  expect(currentTask().dueDate).toEqual(due);expect(currentTask().isCompleted).toBe(false);
  expect(notices()).toHaveLength(1);expect(notices()[0][1].data).toMatchObject({requiresResponse:true});
  await runTaskAutomation('u',false);expect(notices()).toHaveLength(1);
  gmail([mail('マヒトデザイン 注文番号 ORDER-1234。お届け予定日：2026/9/16','delay','2026-09-12T02:00:00.000Z')]);
  await runTaskAutomation('u',false);expect(currentTask().automation).toMatchObject({stage:'shipped',expectedDate:'2026-09-16'});
 });
 it('preserves the reported ETA verbatim when an old receipt is added after shipment',async()=>{
  await recordPurchaseReport('u',report());gmail([mail('マヒトデザイン 注文番号 ORDER-1234。発送しました。お届け予定日：2026/9/18','shipping')]);await runTaskAutomation('u',false);
  await recordPurchaseReport('u',{...report(),id:'old-receipt',report:{...report().report,expectedDate:'2026-09-15'}});
  expect(currentTask().automation).toMatchObject({stage:'shipped',expectedDate:'2026-09-18'});
  expect(documents.get(taskPath()+'/comments/old-receipt')?.content).toContain('到着予定：2026-09-15');
  expect(state().grants[0].records.at(-1)?.after.automation).toMatchObject({stage:'shipped',expectedDate:'2026-09-18'});
 });
 it('rejects another order on an already tracked task without discarding prior information',async()=>{
  await recordPurchaseReport('u',report());const before=structuredClone([...documents]);
  await expect(recordPurchaseReport('u',{...report(),id:'new',report:{...report().report,orderNumber:'OTHER'}})).rejects.toThrow('追跡');
  expect([...documents]).toEqual(before);
 });
 it('can record without Gmail and does not silently enable tracking',async()=>{
  documents.get('connections/u')!.enabled=[];
  await expect(recordPurchaseReport('u',report())).rejects.toThrow('未接続');expect(activities()).toHaveLength(0);
  await recordPurchaseReport('u',{...report(),track:false});expect(state()).toBeUndefined();expect(currentTask().isCompleted).toBe(false);expect(notices()).toHaveLength(0);
 });
 it('rejects child tasks and viewers without writing a receipt',async()=>{
  currentTask().parentTaskId='parent';await expect(recordPurchaseReport('u',report())).rejects.toThrow('親タスク');
  delete currentTask().parentTaskId;member('u','viewer');await expect(recordPurchaseReport('u',report())).rejects.toThrow();expect(activities()).toHaveLength(0);
 });
});

it('can undo a shipment status and ETA without deleting the report or changing its deadline',async()=>{
 const input={id:'purchase-undo',projectId:'p',taskId:'self',track:true,attachment:null,report:{merchant:'マヒトデザイン',orderNumber:'ORDER-1234',item:'名刺',orderedOn:'2026-09-11',stage:'ordered',expectedDate:null,sourceText:'注文しました',question:''}};
 await recordPurchaseReport('u',input);gmail([mail('マヒトデザイン 注文番号 ORDER-1234。発送しました。お届け予定日：2026/9/15','ship')]);await runTaskAutomation('u',false);
 const record=state().grants[0].records.at(-1)!;
 await undoAutomation('u','p','self',record.id,state().revision);
 expect(notices()).toHaveLength(1);for(const [,notice] of notices())expect(notice).toMatchObject({isRead:true,data:{requiresResponse:false,retracted:true}});
 expect(currentTask().automation).toMatchObject({stage:'ordered',expectedDate:null,check:'conflict'});expect(state().grants[0].rule.enabled).toBe(false);expect(documents.has(taskPath()+'/comments/purchase-undo')).toBe(true);
});

describe('report-only shares the existing comment contract',()=>{
 const input=()=>({id:'report-only',projectId:'p',taskId:'self',track:false,attachment:null,report:{merchant:'',orderNumber:'',item:'',orderedOn:null,stage:null,expectedDate:null,sourceText:'名刺を受け取りました。',question:''}});
 it.each(['completed','abandoned'] as const)('records on a %s parent without reopening or reading automation state',async kind=>{
  currentTask()[kind==='completed'?'isCompleted':'isAbandoned']=true;
  documents.set('users/u/settings/aiSettings',{allowedProjectIds:[]});
  fake.failRead='users/u/secretary/task-automation';const parent=structuredClone(currentTask());
  const result=await recordPurchaseReport('u',input());
  expect(result).toMatchObject({tracked:false,alreadyApplied:false});expect(currentTask()).toEqual(parent);expect(state()).toBeUndefined();
  expect(documents.get(taskPath()+'/comments/report-only')?.content).toBe('名刺を受け取りました。');expect(notices()).toHaveLength(0);
 });
 it('preserves another order, its owner, full tracking history and original attachment',async()=>{
  documents.set('connections/v',{enabled:['gmail'],epoch:'v1'});await saveAutomationRule('v',rule(),0);const before=structuredClone(state('v'));const parent=structuredClone(currentTask());
  documents.set('users/u/secretary/task-automation',{uid:'u',revision:1,grants:Array.from({length:40},()=>structuredClone(before.grants[0])),reminders:[],automationEnabled:true});
  const own=structuredClone(state());
  const attachment={id:'image',url:'https://firebasestorage.googleapis.com/v0/b/example/o/projects%2Fp%2Ftasks%2Fself%2Fcomment_attachments%2Fimage',name:'receipt.png',type:'image/png',size:4};
  await recordPurchaseReport('u',{...input(),attachment,report:{...input().report,orderNumber:'ANOTHER-ORDER'}});
  expect(state('v')).toEqual(before);expect(state()).toEqual(own);expect(currentTask()).toEqual(parent);
  expect(documents.get(taskPath()+'/comments/report-only')?.attachments).toEqual([attachment]);expect(notices()).toHaveLength(0);
 });
 it('returns the original receipt after deletion and never recreates the comment on retry',async()=>{
  await recordPurchaseReport('u',input());documents.delete(taskPath()+'/comments/report-only');const before=structuredClone([...documents]);
  expect(await recordPurchaseReport('u',input())).toMatchObject({tracked:false,alreadyApplied:true});expect([...documents]).toEqual(before);
 });
 it('does not enable tracking or overwrite a report when its receipt is reused with track=true',async()=>{
  await recordPurchaseReport('u',input());const before=structuredClone([...documents]);
  expect(await recordPurchaseReport('u',{...input(),track:true,report:{...input().report,merchant:'ショップ',item:'名刺',orderNumber:'ORDER-2',stage:'ordered'}})).toMatchObject({tracked:false,alreadyApplied:true});
  expect([...documents]).toEqual(before);
 });
 it('returns a legacy report-only receipt without duplicating it',async()=>{
  documents.set('projects/p/activityLogs/purchase-report-only',{userId:'u',targetId:'self',tracked:false});const before=structuredClone([...documents]);
  expect(await recordPurchaseReport('u',input())).toMatchObject({tracked:false,alreadyApplied:true});expect([...documents]).toEqual(before);
 });
 it.each(['viewer','archived','child','foreign_receipt','colliding_comment'] as const)('rejects %s without writing anything',async reason=>{
  if(reason==='viewer')member('u','viewer');
  if(reason==='archived')currentTask().isArchived=true;
  if(reason==='child')currentTask().parentTaskId='parent';
  if(reason==='foreign_receipt')documents.set('projects/p/activityLogs/comment-report-only',{userId:'v',sourceTaskId:'self'});
  if(reason==='colliding_comment')documents.set(taskPath()+'/comments/report-only',{content:'既存の本文'});
  const before=structuredClone([...documents]);await expect(recordPurchaseReport('u',input())).rejects.toThrow();expect([...documents]).toEqual(before);
 });
 it('does not accept empty content without an attachment and still requires identity for tracking',async()=>{
  await expect(recordPurchaseReport('u',{...input(),report:{...input().report,sourceText:' '}})).rejects.toThrow('本文か画像');
  await expect(recordPurchaseReport('u',{...input(),track:true})).rejects.toThrow('追跡には');expect(activities()).toHaveLength(0);
 });
 it('preserves the input and makes exactly one comment after an atomic save failure',async()=>{
  fake.failCommit=true;await expect(recordPurchaseReport('u',input())).rejects.toThrow('Synthetic commit');expect(activities()).toHaveLength(0);
  expect(documents.has(taskPath()+'/comments/report-only')).toBe(false);
  await recordPurchaseReport('u',input());await recordPurchaseReport('u',input());expect(activities()).toHaveLength(1);expect(notices()).toHaveLength(0);
 });
});
