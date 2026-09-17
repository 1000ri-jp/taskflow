import { completionBlockReason } from '@/lib/task/completion';
import { prepareRecurrence } from '@/lib/task/recurrenceRepository';
import { expandTaskReviews } from '@/lib/task/reviews';
import type { Task } from '@/types';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference, DocumentSnapshot, Query, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { isGoogleConfigured } from '@/lib/google/workspace/security';
import { cacheRef, connectionRef, type Connection } from '@/lib/google/workspace/oauth';
import { workspaceView } from '@/lib/google/workspace/repository';
import { applyAction, mergeReview, needsReview, SecretaryError } from './engine';
import { currentIncomingReview, incomingMessages, incomingNeedsReview, incomingSourceUsable } from './incoming';
import { validateIncoming } from './interpretIncoming';
import { applyIncomingAction, visibleIncomingDecisions, type IncomingActionRequest } from './incomingDecisions';
import { emptySecretaryState, type ActionRequest, type SecretarySnapshot, type SecretaryState, type SecretaryTask, type SecretaryView, type TaskContext } from './types';

// New subcollection is denied by existing client Rules. Only this authenticated API writes it.
const statePath = (uid: string) => `users/${uid}/secretary/state`;
function canonical(value: unknown): unknown {
  if (value instanceof Date || value && typeof value === 'object' && 'toDate' in value) return iso(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
function iso(value: unknown): string | null {
  const date = value instanceof Date ? value : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : null;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
function storedState(value: unknown): SecretaryState {
  if (!value) return emptySecretaryState();
  const s = value as SecretaryState;
  if (s.schema !== 1 || !Number.isSafeInteger(s.revision) || !Array.isArray(s.proposals) || !Array.isArray(s.decisions) || !Array.isArray(s.history)) throw new SecretaryError('INVALID', '保存形式を読み込めませんでした。');
  return s;
}
function scopedState(state: SecretaryState, snapshot: SecretarySnapshot): SecretaryState {
  const keys = new Set(snapshot.tasks.map(t => t.key));
  const scoped = { ...state, proposals: state.proposals.filter(p => keys.has(p.key)), decisions: state.decisions.filter(d => keys.has(d.key)), history: state.history.filter(h => keys.has(h.key)) };
  // Never return excerpts from a previous selection, connection, or revoked project.
  if (!currentIncomingReview(state, snapshot)) delete scoped.incomingReview;
  if (state.incomingDecisions) scoped.incomingDecisions = visibleIncomingDecisions(state, snapshot);
  return scoped;
}

/** All evidence comes from server reads, never client-supplied context. Transaction reads include memberships and AI grants. */
export async function loadSecretary(uid: string, transaction?: Transaction, retainIncoming = false) {
  const db = getAdminDb();
  const doc = (ref: DocumentReference): Promise<DocumentSnapshot> => transaction ? transaction.get(ref) : ref.get();
  const query = (ref: Query): Promise<QuerySnapshot> => transaction ? transaction.get(ref) : ref.get();
  const [settings, stateDoc, projectDocs] = await Promise.all([
    doc(db.doc(`users/${uid}/settings/aiSettings`)), doc(db.doc(statePath(uid))),
    query(db.collection('projects').where('memberIds', 'array-contains', uid).limit(21)),
  ]);
  const state = storedState(stateDoc.data());
  const rawAllowed = settings.data()?.allowedProjectIds;
  if (rawAllowed !== undefined && rawAllowed !== null && (!Array.isArray(rawAllowed) || rawAllowed.some(v => typeof v !== 'string'))) throw new SecretaryError('FORBIDDEN', 'AIアクセス設定を確認できません。');
  const allowed = Array.isArray(rawAllowed) ? strings(rawAllowed) : null;
  const issues: string[] = [];
  if (projectDocs.size > 20) issues.push('プロジェクトは20件まで取得しています。');
  const tasks: SecretaryTask[] = [];
  let excludedProjects = 0;
  let projects = 0;
  let commentTargets = 0;
  const milestones = new Map<string, DocumentSnapshot | null>();
  // Sequential project reads bound concurrency; transaction reads finish before any writes.
  for (const project of projectDocs.docs.slice(0, 20)) {
    const pd = project.data();
    if (pd.isArchived) continue;
    if (allowed && !allowed.includes(project.id)) { excludedProjects++; continue; }
    const members = await query(project.ref.collection('members').where('userId', '==', uid).limit(1));
    const role = members.docs[0]?.data().role;
    if (!['admin', 'editor', 'viewer'].includes(role)) { excludedProjects++; continue; }
    projects++;
    let taskDocs: QuerySnapshot;
    let lists: QuerySnapshot;
    try {
      [taskDocs, lists] = await Promise.all([query(project.ref.collection('tasks').limit(301)), query(project.ref.collection('lists'))]);
    } catch { issues.push(`${project.id}: タスクまたは列を取得できませんでした。`); continue; }
    if (taskDocs.size > 300) issues.push(`${project.id}: タスクは300件まで取得しています。`);
    const originals = taskDocs.docs.slice(0, 300);
    const projected = expandTaskReviews(originals.map(d => ({ ...d.data(), id: d.id, projectId: project.id }) as Task)).filter(t => t.reviewRecordId);
    // A request reads the original parent conversation; it has no task document of its own.
    const reviewRows = projected.map(t => ({ id: t.id, ref: originals.find(d => d.id === t.parentTaskId)!.ref, data: () => t }));
    for (const td of [...originals, ...reviewRows]) {
      const t = td.data();
      const key = `${project.id}/${td.id}`;
      if (t.isArchived) continue;
      const targeted = strings(t.assigneeIds).includes(uid) && (!t.isCompleted && !t.isAbandoned) || state.proposals.some(p => p.key === key);
      let complete = true;
      let comments: SecretaryTask['comments'] = [];
      let commentVersions: string[] = [];
      let checklists: SecretaryTask['checklists'] = [];
      let checklistStatus: SecretaryTask['checklistStatus'] = 'not_requested';
      if (targeted) {
        commentTargets++;
        if (commentTargets > 60) { complete = false; }
        else {
          try {
            // Read full bounded comment history, including old promises, rather than a recent-only window.
            const [cs, cls] = await Promise.all([query(td.ref.collection('comments').limit(101)), query(td.ref.collection('checklists').limit(21))]);
            checklistStatus = cls.size <= 20 ? 'ready' : 'unavailable';
            checklists = cls.docs.slice(0, 20).map(c => {
              const data = c.data();
              if (typeof data.title !== 'string' || data.title.length > 300 || !Array.isArray(data.items) || data.items.length > 100) checklistStatus = 'unavailable';
              const items = (Array.isArray(data.items) ? data.items : []).slice(0, 100).flatMap(item => {
                if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || item.text.length > 1000 || typeof item.isChecked !== 'boolean') { checklistStatus = 'unavailable'; return []; }
                return [{ id: item.id, text: item.text, isChecked: item.isChecked }];
              });
              return { id: c.id, title: typeof data.title === 'string' ? data.title.slice(0, 300) : '', items };
            });
            complete = cs.size <= 100 && checklistStatus === 'ready';
            commentVersions = cs.docs.map(c => `${c.id}:${c.updateTime?.toMillis()}`);
            comments = cs.docs.slice(0, 100).map(c => {
              const cd = c.data(); const content = typeof cd.content === 'string' ? cd.content : '';
              if (content.length > 8000 || !iso(cd.createdAt)) complete = false;
              return { id: c.id, content: content.slice(0, 8000), authorId: typeof cd.authorId === 'string' ? cd.authorId : '', createdAt: iso(cd.createdAt) ?? '' };
            }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          } catch { complete = false; checklistStatus = 'unavailable'; }
        }
        if (!complete) issues.push(`${key}: コメント・チェックリストを取得しきれていません（対象60タスク、各100コメント・20リスト・各100項目）。`);
      }
      const title = typeof t.title === 'string' ? t.title : '';
      const description = typeof t.description === 'string' ? t.description : '';
      const contextText = (raw: unknown, maximum: number) => {
        if (raw == null) return '';
        if (typeof raw !== 'string' || raw.length > maximum) { complete = false; issues.push(`${key}: 目的・親・節目の説明を取得しきれていません。`); }
        return typeof raw === 'string' ? raw.slice(0, maximum) : '';
      };
      const validId = (id: unknown): id is string => typeof id === 'string' && /^[^/]{1,200}$/.test(id);
      const parent = t.parentTaskId ? taskDocs.docs.slice(0, 300).find(d => d.id === t.parentTaskId && !d.data().isArchived && d.id !== td.id) : undefined;
      let milestone: DocumentSnapshot | null = null;
      if (t.milestoneId && targeted) {
        const milestoneKey = `${project.id}/${t.milestoneId}`;
        if (!milestones.has(milestoneKey) && validId(t.milestoneId) && milestones.size < 60) {
          try { milestones.set(milestoneKey, await doc(project.ref.collection('milestones').doc(t.milestoneId))); }
          catch { milestones.set(milestoneKey, null); }
        }
        milestone = milestones.get(milestoneKey) ?? null;
      }
      const md = milestone?.exists ? milestone.data() : undefined;
      const parentData = parent?.data();
      const sourceId = t.sourceCommentTaskId || t.parentTaskId;
      const sourceExists = validId(sourceId) && taskDocs.docs.slice(0, 300).some(d => d.id === sourceId && !d.data().isArchived);
      const context: TaskContext = {
        projectDescription: contextText(pd.description, 8000),
        parentState: !t.parentTaskId ? 'unset' : parentData ? 'ready' : 'missing',
        parent: parentData ? { taskId: parent!.id, title: contextText(parentData.title, 500), description: contextText(parentData.description, 8000), assigneeIds: strings(parentData.assigneeIds), isCompleted: parentData.isCompleted === true, isAbandoned: parentData.isAbandoned === true } : null,
        milestoneState: !t.milestoneId ? 'unset' : !targeted ? 'not_requested' : md ? 'ready' : 'missing',
        milestone: md ? { ...(md.kind === 'date' || md.kind === 'achievement' ? { kind: md.kind } : {}), achievementCondition: contextText(md.achievementCondition, 2000), requiredTaskIds: strings(md.requiredTaskIds), id: milestone!.id, title: contextText(md.title, 500), description: contextText(md.description, 8000), status: typeof md.status === 'string' ? md.status : 'unknown', dueDate: iso(md.dueDate) } : null,
        taskKind: t.taskKind === 'review_request' ? 'review_request' : t.taskKind === 'decision' ? 'decision' : 'task',
        completionCriteria: contextText(t.completionCriteria, 2000), primaryAssigneeId: typeof t.primaryAssigneeId === 'string' ? t.primaryAssigneeId : null,
        ...(t.review ? { review: t.review } : {}), ...(t.workProgress ? { workProgress: t.workProgress } : {}),
        sourceComment: sourceExists && validId(t.sourceCommentId) ? { taskId: sourceId, commentId: t.sourceCommentId } : null,
      };
      if (context.parentState === 'missing' || context.milestoneState === 'missing' || md?.dueDate != null && !iso(md.dueDate) || t.sourceCommentId && !context.sourceComment) {
        complete = false; issues.push(`${key}: 関連する親・節目・確認依頼が未取得です（節目は最大60件）。`);
      }
      if (t.dueDate != null && !iso(t.dueDate) || t.startDate != null && !iso(t.startDate)) { complete = false; issues.push(`${key}: 日付を正しく読み取れませんでした。`); }
      if (title.length > 500 || description.length > 8000) { complete = false; issues.push(`${key}: 本文が取得上限を超えています。`); }
      const workState = t.workState;
      const validWorkState = workState && ['hold', 'wait'].includes(workState.status)
        && typeof workState.reason === 'string' && typeof workState.resumeCondition === 'string'
        && (workState.reviewAt === null || typeof workState.reviewAt === 'string' && Number.isFinite(Date.parse(workState.reviewAt)));
      if (workState != null && !validWorkState) { complete = false; issues.push(`${key}: 保留・待ちの条件を読み取れませんでした。`); }
      const value: Omit<SecretaryTask, 'version'> = {
        workState: validWorkState ? { status: workState.status, reason: workState.reason, resumeCondition: workState.resumeCondition, reviewAt: workState.reviewAt } : null,
        key, projectId: project.id, taskId: td.id, projectName: typeof pd.name === 'string' ? pd.name : project.id,
        title: title.slice(0, 500), description: description.slice(0, 8000), listName: lists.docs.find(l => l.id === t.listId)?.data().name ?? '列不明',
        assigneeIds: strings(t.assigneeIds), dependsOn: strings(t.dependsOnTaskIds).map(id => `${project.id}/${id}`),
        priority: typeof t.priority === 'string' ? t.priority : null, startDate: iso(t.startDate), dueDate: iso(t.dueDate), isDueDateFixed: t.isDueDateFixed === true,
        durationDays: typeof t.durationDays === 'number' && Number.isFinite(t.durationDays) ? t.durationDays : null,
        isCompleted: t.isCompleted === true, isAbandoned: t.isAbandoned === true, isArchived: false, completedAt: iso(t.completedAt),
        comments, checklists, checklistStatus, complete, canWrite: role === 'admin' || role === 'editor', context,
      };
      tasks.push({ ...value, version: `${hash(t)}.${hash([commentVersions, value.comments, value.checklists, value.checklistStatus, value.complete, value.canWrite, value.listName, value.projectName, context])}` });
    }
  }
  tasks.sort((a, b) => a.key.localeCompare(b.key));
  const coverage: SecretarySnapshot['coverage'] = { status: issues.length ? 'partial' : tasks.some(t => t.assigneeIds.includes(uid) && !t.isCompleted && !t.isAbandoned) ? 'ready' : 'empty', issues, projects, excludedProjects };
  let calendar: SecretarySnapshot['calendar'];
  let incoming: SecretarySnapshot['incoming'];
  const checkedAt = new Date().toISOString();
  if (isGoogleConfigured()) {
    const [connection, cache, owner] = await Promise.all([doc(connectionRef(uid)), doc(cacheRef(uid)), doc(db.doc(`users/${uid}`))]);
    const google = workspaceView(connection.data() as Connection | undefined, cache.data() as Parameters<typeof workspaceView>[1]);
    if (google.sources.calendar.connected) calendar = google.sources.calendar;
    if (google.sources.gmail.connected || google.sources.chat.connected) {
      const sources = { gmail: google.sources.gmail, chat: google.sources.chat };
      const ownerName = typeof owner.data()?.displayName === 'string' ? owner.data()!.displayName.slice(0, 100) : '';
      incoming = { email: google.email ?? '', ownerName, sources,
        connectionEpoch: connection.data()?.epoch,
        accessScope: hash([uid, google.email, google.gmailLabels, google.selectedSpaces, rawAllowed ?? null, [...new Set(tasks.map(t => `${t.projectId}:${t.canWrite}`))].sort()]),
        sourceVersions: Object.fromEntries(Object.entries(sources).flatMap(([service, source]) => source.items.map(item => [`${service}:${item.id}`, hash(item)]))),
        selections: { gmail: google.gmailLabels.map(s => s.name), chat: google.selectedSpaces.map(s => s.name) },
        signature: hash(['incoming-v8', uid, google.email, ownerName, google.gmailLabels, google.selectedSpaces,
          Object.entries(sources).map(([service, s]) => [service, s.connected, s.status, incomingSourceUsable(s, checkedAt), s.items]),
          tasks.map(t => [t.key, t.version]), coverage,
          state.decisions.filter(d => tasks.some(t => t.key === d.key)).map(d => [d.key, d.disposition, d.correction ?? d.reason, d.reviewAt])]) };
    }
  }
  // A timestamp-only refresh must not invalidate every decision when sources are unchanged.
  const signatureData: unknown[] = [uid, tasks.map(t => [t.key, t.version]), coverage];
  if (calendar) signatureData.push({ status: calendar.status, items: calendar.items });
  const snapshot: SecretarySnapshot = { userId: uid, tasks, checkedAt, coverage, signature: hash(signatureData), ...(calendar ? { calendar } : {}), ...(incoming ? { incoming } : {}) };
  const scoped = scopedState(state, snapshot);
  return { state: retainIncoming ? { ...scoped, incomingDecisions: state.incomingDecisions ?? [] } : scoped, snapshot };
}
export async function readSecretary(uid: string): Promise<SecretaryView> {
  const loaded = await loadSecretary(uid, undefined, true);
  const all = loaded.state.incomingDecisions ?? []; const visible = visibleIncomingDecisions(loaded.state, loaded.snapshot);
  const inactive = all.filter(d => d.status === 'cleared' || !visible.some(v => v.key === d.key));
  const state = scopedState(loaded.state, loaded.snapshot);
  // Organization drafts retain private source text and are exposed only by their scoped API.
  Reflect.deleteProperty(state, 'organization');
  return { snapshot: loaded.snapshot, state, incomingStorage: { count: all.length, inactive: inactive.length, heldInactive: inactive.filter(d => d.status === 'hold').length }, needsReview: needsReview(state, loaded.snapshot, loaded.snapshot.checkedAt) || incomingNeedsReview(state, loaded.snapshot), mode: 'live' };
}
export async function saveReview(uid: string, expected: { revision: number; signature: string }, raw: unknown, incoming?: { signature: string; raw: unknown }) {
  const db = getAdminDb();
  await db.runTransaction(async tx => {
    const { state, snapshot } = await loadSecretary(uid, tx, true);
    if (state.revision !== expected.revision || snapshot.signature !== expected.signature) throw new SecretaryError('CONFLICT', '整理中に情報が変わりました。最新情報で再整理してください。');
    if (incoming && snapshot.incoming?.signature !== incoming.signature) throw new SecretaryError('CONFLICT', '整理中にメール・Chatの取得範囲や情報が変わりました。最新情報で再整理してください。');
    const next = raw === undefined ? { ...state, revision: state.revision + 1 } : mergeReview(state, snapshot, raw, snapshot.checkedAt, randomUUID());
    if (incoming) {
      const messages = incomingMessages(snapshot);
      next.incomingReview = { signature: incoming.signature, reviewedAt: snapshot.checkedAt,
        candidates: validateIncoming(incoming.raw, snapshot), counts: { gmail: messages.filter(m => m.service === 'gmail').length, chat: messages.filter(m => m.service === 'chat').length } };
    }
    tx.set(db.doc(statePath(uid)), next);
  });
  return readSecretary(uid);
}
export async function actOnSecretary(uid: string, request: ActionRequest) {
  const db = getAdminDb();
  await db.runTransaction(async tx => {
    const { state, snapshot } = await loadSecretary(uid, tx, true);
    const now = snapshot.checkedAt;
    const transition = applyAction(state, snapshot, request, now, randomUUID());
    if (transition.patch) {
      const taskRef = db.doc(`projects/${transition.key.split('/')[0]}/tasks/${transition.key.split('/')[1]}`);
      const beforeTask = await tx.get(taskRef);
      const task = snapshot.tasks.find(t => t.key === transition.key)!;
      if (task.context?.taskKind === 'review_request') throw new SecretaryError('INVALID', '確認依頼は親タスクのやりとりから操作してください。');
      if (transition.patch.isCompleted === true) {
        const graph = await tx.get(taskRef.parent.limit(501));
        if(graph.size > 500) throw new SecretaryError('INVALID','仕事の全体を取得しきれません。詳細で確認してください。');
        const reason=completionBlockReason({...beforeTask.data(),id:taskRef.id,projectId:task.projectId} as Task,graph.docs.map(d=>({...d.data(),id:d.id,projectId:task.projectId}) as Task));
        if(reason) throw new SecretaryError('INVALID',reason);
      }
      const changed = { ...transition.patch,
        ...('completedAt' in transition.patch ? { completedAt: transition.patch.completedAt ? new Date(transition.patch.completedAt) : null } : {}),
        ...('dueDate' in transition.patch ? { dueDate: transition.patch.dueDate ? new Date(transition.patch.dueDate) : null } : {}),
        updatedAt: new Date(now), secretaryMutationId: randomUUID() };
      const repeat = transition.patch.isCompleted === true ? await prepareRecurrence(tx, taskRef, { ...beforeTask.data(), ...changed, id:taskRef.id, projectId:task.projectId } as unknown as Task,new Date(now)) : () => {};
      repeat();
      tx.update(taskRef, changed);
      tx.set(taskRef.parent.parent!.collection('activityLogs').doc(), { projectId: taskRef.parent.parent!.id, targetType: 'task', targetId: taskRef.id,
        targetName: snapshot.tasks.find(t => t.key === transition.key)!.title, action: 'update', userId: uid, userName: 'dueDate' in transition.patch ? '本人がNeoから期限を変更' : 'AI秘書の提案を本人が採用', createdAt: new Date(now),
        changes: 'dueDate' in transition.patch
          ? Object.entries(transition.patch).map(([field, value]) => ({ field, oldValue: String(task[field as keyof SecretaryTask] ?? ''), newValue: String(value ?? '') }))
          : [{ field: 'status', oldValue: JSON.stringify({ isCompleted: task.isCompleted, isAbandoned: task.isAbandoned }), newValue: JSON.stringify(transition.patch) }] });
      // Compare all task fields and comment versions; another editor's later changes block undo.
      const item = transition.state.history.find(h => h.afterNonce === transition.state.decisions.find(d => d.key === transition.key)?.nonce);
      if (item && request.action !== 'undo') item.afterVersion = `${hash({ ...beforeTask.data(), ...changed })}.${task.version.split('.')[1]}`;
    }
    tx.set(db.doc(statePath(uid)), transition.state);
  });
  return readSecretary(uid);
}
export async function actOnIncoming(uid: string, request: IncomingActionRequest) {
  const db = getAdminDb();
  await db.runTransaction(async tx => {
    const { state, snapshot } = await loadSecretary(uid, tx, true);
    const next = applyIncomingAction(state, snapshot, request);
    if (next !== state) tx.set(db.doc(statePath(uid)), next);
  });
  return readSecretary(uid);
}
