import { getTask } from './firestore';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { taskVersion } from '@/lib/task/workflow';
import { TaskParentRejected } from '@/lib/task/parentTask';

/** The server transaction reads the project graph, including children, before reparenting. */
export async function updateTaskParent(projectId: string, taskId: string, parentId: string | null) {
  if ([projectId, taskId, ...(parentId === null ? [] : [parentId])].some(id => !id || id.includes('/'))) throw new TaskParentRejected('タスクの指定が正しくありません。');
  const task = await getTask(projectId, taskId);
  if (!task) throw new TaskParentRejected('タスクが見つかりません。');
  const previousParentId = task.parentTaskId || null;
  if (previousParentId === parentId) return { changed: false, previousParentId };
  await sendWorkflow(projectId, taskId, { id: crypto.randomUUID(), action: 'reparent', expectedVersion: taskVersion(task), parentTaskId: parentId });
  return { changed: true, previousParentId };
}
