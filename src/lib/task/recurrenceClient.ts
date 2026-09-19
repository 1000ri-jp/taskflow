import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Task } from '@/types';
import type { OrganizationMock } from './organizationMock';
import { nextRecurrence, repeatTask, repeatChecklist, validRecurrence, type RecurrenceSettings } from './recurrence';

export function repeatMockTask(state: OrganizationMock, source: Task) {
  if (!source.recurrence) return;
  const next = repeatTask(source, new Date()); if (!next) return;
  const receiptId = `recurrence-${source.recurrence.seriesId}-${source.recurrence.occurrence}`;
  if (state.activityLogs.some(log=>log.id === receiptId)) return;
  if (state.data.tasks[next.id] || !state.data.listIds.includes(next.task.listId)) throw new Error('次回タスクの作成先を確認してください。');
  state.data.tasks[next.id] = { ...next.task };
  for (const [path, data] of Object.entries(state.data.children)) if (path.startsWith(`tasks/${source.id}/checklists/`)) state.data.children[`tasks/${next.id}/checklists/${path.split('/').at(-1)}`] = repeatChecklist(data, next.id, next.shiftDays, new Date());
  state.activityLogs.push({id:receiptId,sourceTaskId:source.id,nextTaskId:next.id,createdAt:new Date()});
}
export async function recurrenceRequest(projectId:string, taskId:string, input:{action:'configure';expectedVersion:string;settings:RecurrenceSettings|null}|{action:'complete';patch:Record<string,unknown>}) {
  if (isE2EMockAuthEnabled()) {
    const { mutateOrganizationMock } = await import('./organizationMock');
    return mutateOrganizationMock(projectId, state => {
      const task = state.data.tasks[taskId]; if (!task) throw new Error('タスクが見つかりません。');
      if (input.action === 'complete') {
        repeatMockTask(state,{...task,...input.patch,id:taskId,projectId} as unknown as Task);
        state.data.tasks[taskId]={...task,...input.patch,completedAt:new Date(),updatedAt:new Date()}; return;
      }
      const { settings } = input;
      if (settings?.seriesId === (task.recurrence as RecurrenceSettings | undefined)?.seriesId && settings) return;
      const previous = task.recurrence as Task['recurrence'];
      if (previous && state.activityLogs.some(log=>log.id===`recurrence-${previous.seriesId}-${previous.occurrence}`)) throw new Error('次回分が作成済みです。次回タスクの設定を変更してください。');
      if ((task.updatedAt as Date)?.toISOString() !== input.expectedVersion || task.isCompleted || task.isArchived || task.taskKind === 'review_request') throw new Error('タスクの状態が変わりました。開き直してください。');
      const rule = settings ? {...settings,occurrence:0} : null;
      if (rule && (!validRecurrence(rule) || !state.data.listIds.includes(rule.listId))) throw new Error('繰り返し設定を確認してください。');
      if (rule) nextRecurrence(rule);
      task.recurrence = rule; task.updatedAt = new Date();
    });
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/recurrence`, {method:'POST',headers:await getAuthHeaders(),body:JSON.stringify(input)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '保存できませんでした。');
  window.dispatchEvent(new Event('taskflow-work-updated'));
}
