import { getAdminDb } from './admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { isCountdownTarget, type CountdownTarget, type SharedCountdownData } from '@/lib/dashboard/countdown';

// This is the only document written by this feature. Client rules deny direct access.
export const COUNTDOWN_DOCUMENT = 'sharedSettings/dashboardCountdown';

function selection(data: Record<string, unknown> | undefined) {
  if (!data) return { target: null, revision: 0 };
  if ((data.target !== null && !isCountdownTarget(data.target)) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) {
    throw new Error('INVALID_STORED_COUNTDOWN');
  }
  return { target: data.target as CountdownTarget | null, revision: data.revision as number };
}

function dateString(value: unknown): string | null {
  const date = value instanceof Date ? value : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : null;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export async function readSharedCountdown(userId: string): Promise<SharedCountdownData> {
  const db = getAdminDb();
  const saved = selection((await db.doc(COUNTDOWN_DOCUMENT).get()).data());
  if (!saved.target) return { ...saved, status: 'unset', task: null };
  try { await getProjectAccess(userId, saved.target.projectId, null, null, 'tasks:read'); }
  catch (error) {
    if (error instanceof Error && ['FORBIDDEN', 'NOT_FOUND'].includes(error.message)) {
      return { revision: saved.revision, target: null, task: null, status: error.message === 'FORBIDDEN' ? 'restricted' : 'unavailable' };
    }
    throw error;
  }
  const projectRef = db.collection('projects').doc(saved.target.projectId);
  const [project, task] = await Promise.all([projectRef.get(), projectRef.collection('tasks').doc(saved.target.taskId).get()]);
  const projectData = project.data();
  const taskData = task.data();
  if (!projectData || projectData.isArchived || !taskData || taskData.isArchived) return { ...saved, status: 'unavailable', task: null };
  return {
    ...saved, status: 'ready',
    task: {
      title: typeof taskData.title === 'string' ? taskData.title : '名称未設定',
      projectName: typeof projectData.name === 'string' ? projectData.name : 'プロジェクト',
      dueDate: dateString(taskData.dueDate),
      isCompleted: taskData.isCompleted === true,
      isAbandoned: taskData.isAbandoned === true,
    },
  };
}

export async function saveSharedCountdown(userId: string, target: CountdownTarget | null, expectedRevision: number): Promise<void> {
  const db = getAdminDb();
  const ref = db.doc(COUNTDOWN_DOCUMENT);
  await db.runTransaction(async (transaction) => {
    const current = selection((await transaction.get(ref)).data());
    if (current.revision !== expectedRevision) throw new Error('CONFLICT');
    const permissionTarget = target ?? current.target;
    if (permissionTarget) await getProjectAccess(userId, permissionTarget.projectId, null, null, 'tasks:write');
    if (target) {
      const projectRef = db.collection('projects').doc(target.projectId);
      const [project, task] = await Promise.all([transaction.get(projectRef), transaction.get(projectRef.collection('tasks').doc(target.taskId))]);
      const taskData = task.data();
      if (!project.exists || project.data()?.isArchived || !taskData || taskData.isArchived || taskData.isAbandoned || taskData.isCompleted || !dateString(taskData.dueDate)) {
        throw new Error('INVALID_COUNTDOWN_TASK');
      }
    }
    // No task title, date, completion state, comment, or notification is written.
    transaction.set(ref, { target, revision: current.revision + 1 });
  });
}
