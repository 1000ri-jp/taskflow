import type { DashboardTask } from './brief';
import type { GoogleItem } from '@/lib/google/workspace/types';

/** Personal time reservations. Never reuse startDate/dueDate as work hours. */
export interface WorkBlock { id: string; projectId: string; taskId: string; start: string; end: string }
export const WORK_BLOCK_KEY = 'taskflow.workBlocks.v1';
export const workBlockKey = (userId: string) => `${WORK_BLOCK_KEY}:${encodeURIComponent(userId)}`;
export const taskHref = (task: Pick<DashboardTask, 'projectId' | 'id'>) => `/projects/${encodeURIComponent(task.projectId)}/board?task=${encodeURIComponent(task.id)}`;

export function workBlockError(block: WorkBlock): string | null {
  if (!block.id || !block.projectId || !block.taskId) return '作業するタスクを選んでください。';
  const start = Date.parse(block.start), end = Date.parse(block.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '開始と終了の日時を入力してください。';
  if (end <= start) return '終了は開始より後の時刻にしてください。';
  if (end - start > 86400000) return '作業時間は24時間以内にしてください。';
  return null;
}

export function parseWorkBlocks(raw: string | null): WorkBlock[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some(item => !item || ['id', 'projectId', 'taskId', 'start', 'end'].some(key => typeof item[key] !== 'string') || workBlockError(item))) {
    throw new Error('保存した作業時間を読み取れません。');
  }
  return value;
}

export function scheduledWork(tasks: readonly DashboardTask[], blocks: readonly WorkBlock[]) {
  return blocks.flatMap(block => {
    const task = tasks.find(task => task.projectId === block.projectId && task.id === block.taskId && !task.isArchived && !task.isAbandoned && !task.isCompleted);
    if (!task || workBlockError(block)) return [];
    const event: GoogleItem = { id: `work:${block.id}`, title: task.title, at: block.start, end: block.end, text: '', sourceName: '作業時間', url: taskHref(task), eventType: 'taskflowWork' };
    return [{ block, task, event }];
  });
}
