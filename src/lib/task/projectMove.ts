import type { Task } from '@/types';
import { OrganizationError, type OrganizationDocument } from './organizationEngine';

export interface ProjectMoveChoice { id: string; name: string; lists: { id: string; name: string }[] }
export interface ProjectMoveContext { currentName: string; projects: ProjectMoveChoice[] }
export interface ProjectMoveInput { id: string; targetProjectId: string; listId: string; version?: string }
export interface ProjectMovePreview { version: string; taskCount: number; commentCount: number; attachmentCount: number; checklistCount: number; targetName: string; listName: string }
export interface ProjectMoveResult { projectId: string; taskId: string }
export interface ProjectMoveData {
  sourceId: string; targetId: string; taskId: string; listId: string;
  tasks: Record<string, OrganizationDocument>; targetTasks: Record<string, OrganizationDocument>;
  targetMembers: string[]; targetList: OrganizationDocument;
  labels: Record<string, OrganizationDocument>; tags: Record<string, OrganizationDocument>;
  targetLabels: Record<string, OrganizationDocument>; targetTags: Record<string, OrganizationDocument>;
  milestones: OrganizationDocument[];
}
const fail = (message: string): never => { throw new OrganizationError(message, 409); };
export function projectMoveTaskIds(tasks: ProjectMoveData['tasks'], rootId: string) {
  const root = tasks[rootId];
  if (!root) fail('タスクが見つかりません。開き直してください。');
  if (root.parentTaskId) fail('親タスクを開いて、サブタスクと一緒に移動してください。');
  if (root.isArchived || root.mergedIntoTaskId) fail('アーカイブ・統合済みのタスクは移動できません。');
  const ids = new Set([rootId]);
  let previous = 0;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const [id, task] of Object.entries(tasks)) if (typeof task.parentTaskId === 'string' && ids.has(task.parentTaskId)) ids.add(id);
  }
  if (ids.size > 30) fail('関連するサブタスクが多いため、一括で移動できません。');
  return [...ids].sort();
}
function references(task: Partial<Task>) {
  return [task.parentTaskId, task.sourceCommentTaskId, task.mergedIntoTaskId, ...(task.mergedFromTaskIds ?? []),
    ...(task.dependsOnTaskIds ?? []), ...(task.relatedTaskIds ?? []), task.review?.nextTaskId,
    ...Object.values(task.reviewRequests ?? {}).map(request => request.cycle.nextTaskId)].filter(Boolean) as string[];
}
/** Relocation preserves work state; list automation is deliberately not a completion command. */
export function planProjectMove(data: ProjectMoveData, operationId: string, now: Date) {
  const ids = projectMoveTaskIds(data.tasks, data.taskId);
  const moved = new Set(ids);
  const linkedIds = new Set([...ids, ...ids.flatMap(id => Object.entries((data.tasks[id] as unknown as Task).reviewRequests ?? {}).flatMap(([key, request]) => [key, `review-${request.commentId}`]))]);
  const writes: Record<string, OrganizationDocument> = {};
  for (const [id, raw] of Object.entries(data.tasks)) {
    const task = raw as unknown as Task;
    if (references(task).some(ref => moved.has(id) !== linkedIds.has(ref))) fail(`「${task.title}」に移動対象外のタスクとの関連があります。依存・関連・確認後の作業を確認してください。`);
    if (!moved.has(id)) continue;
    if (data.targetTasks[id]) fail('移動先に同じ識別番号のタスクがあります。上書きせずに停止しました。');
    if (task.milestoneId) fail(`「${task.title}」は節目に関連しています。関連を確認してから移動してください。`);
    if (task.automation?.ownerId && task.automation.check !== 'revoked') fail(`「${task.title}」の自動確認を解除してから移動してください。移動先で改めて任せられます。`);
    const assigned = [...(task.assigneeIds ?? []), ...(task.primaryAssigneeId ? [task.primaryAssigneeId] : []),
      ...Object.values(task.reviewRequests ?? {}).flatMap(request => request.assigneeIds)];
    if (assigned.some(uid => !data.targetMembers.includes(uid))) fail(`「${task.title}」の担当者・確認相手が移動先に参加していません。担当または参加メンバーを確認してください。`);
    if (task.recurrence && data.targetList.autoCompleteOnEnter) fail('繰り返しタスクは、完了扱いにならないリストを選んでください。');
  }
  if (data.milestones.some(m => Array.isArray(m.requiredTaskIds) && m.requiredTaskIds.some(id => moved.has(id)))) fail('移動対象が節目の達成条件になっています。節目の関連を確認してください。');
  const mapDefinitions = (kind: 'labels' | 'tags', key: 'labelIds' | 'tagIds') => {
    const target = kind === 'labels' ? data.targetLabels : data.targetTags;
    const map = new Map<string, string>();
    for (const id of ids) for (const oldId of (data.tasks[id][key] ?? []) as string[]) {
      if (map.has(oldId)) continue;
      const definition = data[kind][oldId];
      if (!definition) fail('ラベル・タグの情報を取得できません。最新の内容を確認してください。');
      const same = Object.entries(target).find(([, row]) => row.name === definition.name && row.color === definition.color);
      const newId = same?.[0] ?? `move-${operationId}-${map.size}`;
      if (!same && target[newId]) fail('移動先のラベル・タグが変わりました。開き直してください。');
      map.set(oldId, newId);
      if (!same) writes[`${kind}/${newId}`] = { ...definition, id: newId, projectId: data.targetId };
    }
    return map;
  };
  const labels = mapDefinitions('labels', 'labelIds'), tags = mapDefinitions('tags', 'tagIds');
  const nextOrder = Math.max(-1, ...Object.values(data.targetTasks).filter(t => t.listId === data.listId).map(t => typeof t.order === 'number' ? t.order : -1)) + 1;
  ids.forEach((id, index) => {
    const task = data.tasks[id];
    writes[`tasks/${id}`] = { ...task, id, projectId: data.targetId, listId: data.listId, order: nextOrder + index,
      labelIds: ((task.labelIds ?? []) as string[]).map(id => labels.get(id)!), tagIds: ((task.tagIds ?? []) as string[]).map(id => tags.get(id)!),
      ...(task.recurrence ? { recurrence: { ...task.recurrence as object, listId: data.listId } } : {}), updatedAt: now };
  });
  return { ids, writes };
}
