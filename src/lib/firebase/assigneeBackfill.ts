import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './config';
import { isE2EMockAuthEnabled } from './testMode';
import { planAssigneeBackfill } from '@/lib/task/assigneeBackfill';

export async function applyProjectAssignee(projectId: string, taskIds: string[], assigneeId: string) {
  if (isE2EMockAuthEnabled()) {
    const { mutateOrganizationMock } = await import('@/lib/task/organizationMock');
    await mutateOrganizationMock(projectId, state => {
      const plan = planAssigneeBackfill(state.data.tasks, taskIds, assigneeId, state.data.defaultAssigneeId, state.data.memberIds);
      for (const row of plan) {
        state.data.tasks[row.id] = { ...state.data.tasks[row.id], assigneeIds: row.assigneeIds, updatedAt: new Date() };
        state.activityLogs.push({ id: crypto.randomUUID(), projectId, targetType: 'task', targetId: row.id, targetName: state.data.tasks[row.id].title, action: 'assign', userId: 'e2e-mock-user', userName: '本人', changes: [{ field: 'assigneeIds', oldValue: [], newValue: row.assigneeIds }], createdAt: new Date() });
      }
    });
    return;
  }
  const db = getFirebaseDb(); const actor = getFirebaseAuth().currentUser;
  if (!actor || !projectId || projectId.includes('/') || taskIds.some(id => !id || id.includes('/')) || taskIds.length > 100) throw new Error('対象またはログイン状態を確認してください。');
  await runTransaction(db, async tx => {
    const project = await tx.get(doc(db, 'projects', projectId));
    if (!project.exists() || project.data().isArchived || !project.data().memberIds?.includes(actor.uid)) throw new Error('プロジェクトを確認できません。');
    const refs = taskIds.map(id => doc(db, 'projects', projectId, 'tasks', id));
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    const tasks = Object.fromEntries(snapshots.filter(s => s.exists()).map(s => [s.id, s.data()]));
    const plan = planAssigneeBackfill(tasks, taskIds, assigneeId, project.data().defaultAssigneeId, project.data().memberIds);
    const at = serverTimestamp();
    for (const [index, row] of plan.entries()) {
      tx.update(refs[index], { assigneeIds: row.assigneeIds, updatedAt: at });
      tx.set(doc(collection(db, 'projects', projectId, 'activityLogs')), { projectId, targetType: 'task', targetId: row.id, targetName: tasks[row.id].title, action: 'assign', userId: actor.uid, userName: actor.displayName || '操作者不明', changes: [{ field: 'assigneeIds', oldValue: '', newValue: assigneeId }], createdAt: at });
    }
  });
}
