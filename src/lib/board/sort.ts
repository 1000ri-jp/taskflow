import type { Task } from '@/types';

export const BOARD_SORT_OPTIONS = [
  { value: 'manual', label: '元の並び順' },
  { value: 'due-asc', label: '期限が早い順' },
  { value: 'due-desc', label: '期限が遅い順' },
  { value: 'start-asc', label: '開始日が早い順' },
  { value: 'start-desc', label: '開始日が遅い順' },
] as const;
export type BoardSort = typeof BOARD_SORT_OPTIONS[number]['value'];
export const isBoardSort = (value: unknown): value is BoardSort => BOARD_SORT_OPTIONS.some(option => option.value === value);

export function sortBoardTasks(tasks: readonly Task[], mode: BoardSort): Task[] {
  return [...tasks].sort((a, b) => {
    // Preserve the existing completed-last presentation in every mode.
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    if (mode === 'manual') return 0;
    const field = mode.startsWith('due-') ? 'dueDate' : 'startDate';
    const left = a[field]?.getTime();
    const right = b[field]?.getTime();
    const hasLeft = left !== undefined && Number.isFinite(left);
    const hasRight = right !== undefined && Number.isFinite(right);
    if (hasLeft !== hasRight) return hasLeft ? -1 : 1;
    if (!hasLeft || !hasRight) return 0;
    return (left! - right!) * (mode.endsWith('asc') ? 1 : -1);
  });
}
