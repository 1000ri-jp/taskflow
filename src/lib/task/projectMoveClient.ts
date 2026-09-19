'use client';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { organizationFingerprint } from './organizationIdentity';
import { OrganizationError } from './organizationEngine';
import { planProjectMove, type ProjectMoveContext, type ProjectMoveInput, type ProjectMovePreview, type ProjectMoveResult } from './projectMove';

export type MoveLocation = (ProjectMoveResult & { commentId?: string }) | null;
type Action = 'context' | 'preview' | 'move' | 'locate';
async function request<T>(projectId: string, taskId: string, action: Action, input?: ProjectMoveInput): Promise<T> {
  if (isE2EMockAuthEnabled()) {
    try { return await mockRequest(projectId, taskId, action, input) as T; }
    catch (error) { if (error instanceof OrganizationError) Object.assign(error, { rejected: true }); throw error; }
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/move`, {
    method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ action, ...input }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '結果を確認できません。同じ操作で再試行してください。'), { rejected: result.rejected === true });
  return result as T;
}
export const getProjectMoveContext = (projectId: string, taskId: string) => request<ProjectMoveContext>(projectId, taskId, 'context');
export const previewProjectMove = (projectId: string, taskId: string, input: ProjectMoveInput) => request<ProjectMovePreview>(projectId, taskId, 'preview', input);
export const locateProjectMove = (projectId: string, taskId: string) => request<MoveLocation>(projectId, taskId, 'locate');
export async function applyProjectMove(projectId: string, taskId: string, input: ProjectMoveInput) {
  const result = await request<ProjectMoveResult>(projectId, taskId, 'move', input);
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return result;
}

async function mockRequest(projectId: string, taskId: string, action: Action, input?: ProjectMoveInput): Promise<unknown> {
  const { readOrganizationMock, organizationMockKey } = await import('./organizationMock');
  const { MEETING_MOCK_PROJECTS } = await import('./meetingMultiExample');
  const lists = (id: string) => {
    const state = readOrganizationMock(id);
    return state.lists ?? state.data.listIds.map(key => ({ id: key, name: '進行中', autoCompleteOnEnter: false }));
  };
  if (action === 'context') return {
    currentName: MEETING_MOCK_PROJECTS.find(p => p.id === projectId)?.name ?? projectId,
    projects: MEETING_MOCK_PROJECTS.filter(p => p.id !== projectId).map(p => ({ ...p, lists: lists(p.id).map(l => ({ id: l.id, name: l.name })) })),
  };
  if (action === 'locate') {
    let location: MoveLocation = { projectId, taskId }; const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const key = `${location.projectId}/${location.taskId}`; if (seen.has(key)) return null; seen.add(key);
      const state = readOrganizationMock(location.projectId);
      if (state.data.tasks[location.taskId]) return i ? location : null;
      const pointer = state.activityLogs.find(log => log.id === `move-pointer-${location!.taskId}`)?.location as MoveLocation;
      if (!pointer) return null; location = pointer;
    }
    return null;
  }
  if (!input) throw new Error('移動先を確認してください。');
  if (input.targetProjectId === projectId) throw new OrganizationError('別のプロジェクトを選んでください。');
  const perform = async () => {
    const source = readOrganizationMock(projectId), target = readOrganizationMock(input.targetProjectId);
    const receipt = source.activityLogs.find(log => log.id === `project-move-${input.id}` && log.receipt);
    if (receipt) {
      if (receipt.taskId !== taskId || JSON.stringify(receipt.input) !== JSON.stringify(input)) throw new Error('操作の保存記録が一致しません。');
      return receipt.receipt;
    }
    const list = lists(input.targetProjectId).find(l => l.id === input.listId); if (!list) throw new Error('移動先のリストが見つかりません。');
    const now = new Date();
    const plan = planProjectMove({ sourceId: projectId, targetId: input.targetProjectId, taskId, listId: input.listId,
      tasks: source.data.tasks, targetTasks: target.data.tasks, targetMembers: target.data.memberIds, targetList: { ...list },
      labels: {}, tags: {}, targetLabels: {}, targetTags: {}, milestones: (source.milestones ?? []).map(m => ({ ...m })) }, input.id, now);
    const ids = new Set(plan.ids);
    const children = Object.fromEntries(Object.entries(source.data.children).filter(([path]) => ids.has(path.split('/')[1])));
    const version = await organizationFingerprint({ tasks: plan.ids.map(id => source.data.tasks[id]), children, list, members: target.data.memberIds });
    if (action === 'preview') return { version, taskCount: ids.size, commentCount: Object.keys(children).filter(path => path.includes('/comments/')).length,
      attachmentCount: Object.keys(children).filter(path => path.includes('/attachments/')).length, checklistCount: Object.keys(children).filter(path => path.includes('/checklists/')).length,
      targetName: MEETING_MOCK_PROJECTS.find(p => p.id === input.targetProjectId)?.name ?? input.targetProjectId, listName: list.name };
    if (version !== input.version) throw Object.assign(new Error('確認後に内容が更新されました。「内容を確認」から読み直してください。'), { rejected: true });
    for (const path of Object.keys(target.data.children)) if (ids.has(path.split('/')[1])) throw new Error('移動先に以前の関連記録が残っています。');
    for (const id of ids) {
      const task = source.data.tasks[id];
      const recurrence = task.recurrence as { seriesId: string; occurrence: number } | undefined;
      if (recurrence) {
        const receiptId = `recurrence-${recurrence.seriesId}-${recurrence.occurrence}`;
        const saved = source.activityLogs.find(log => log.id === receiptId), existing = target.activityLogs.find(log => log.id === receiptId);
        if (existing && (!saved || JSON.stringify(saved) !== JSON.stringify(existing))) throw new OrganizationError('移動先に同じ繰り返しの記録があります。');
        if (saved && !existing) target.activityLogs.push(saved);
      }
      for (const [key, review] of Object.entries(task.reviewRequests ?? {}) as [string, { commentId: string }][]) {
        const location = { projectId: input.targetProjectId, taskId: id, commentId: review.commentId };
        for (const reviewId of [key, `review-${review.commentId}`]) {
          source.activityLogs = source.activityLogs.filter(log => log.id !== `move-pointer-${reviewId}`);
          source.activityLogs.push({ id: `move-pointer-${reviewId}`, location });
        }
      }
      target.data.tasks[id] = plan.writes[`tasks/${id}`]; delete source.data.tasks[id];
      source.activityLogs = source.activityLogs.filter(log => log.id !== `move-pointer-${id}`);
      source.activityLogs.push({ id: `move-pointer-${id}`, location: { projectId: input.targetProjectId, taskId: id } });
    }
    for (const [path, data] of Object.entries(children)) { target.data.children[path] = data; delete source.data.children[path]; }
    target.activityLogs.push(...source.activityLogs.filter(log => ids.has(String(log.targetId))).map(log => ({ ...log, id: `moved-${projectId}-${log.id}`, projectId: input.targetProjectId })));
    const result = { projectId: input.targetProjectId, taskId };
    source.activityLogs.push({ id: `project-move-${input.id}`, taskId, input, receipt: result });
    const sourceKey = organizationMockKey(projectId), targetKey = organizationMockKey(input.targetProjectId);
    const before = localStorage.getItem(sourceKey);
    try { localStorage.setItem(sourceKey, JSON.stringify(source)); localStorage.setItem(targetKey, JSON.stringify(target)); }
    catch (error) { if (before === null) localStorage.removeItem(sourceKey); else localStorage.setItem(sourceKey, before); throw error; }
    return result;
  };
  if (action === 'preview') return perform();
  if (!navigator.locks) throw new Error('このブラウザは隔離データの排他保存に対応していません。');
  const keys = [projectId, input.targetProjectId].sort().map(organizationMockKey);
  return navigator.locks.request(keys[0], () => navigator.locks.request(keys[1], perform));
}
