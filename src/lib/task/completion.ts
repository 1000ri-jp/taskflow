import type { Task } from '@/types';
import { requiredChildrenState } from './automationEngine';
import { parentReviews } from './reviews';
import { taskBlockers } from './status';

/** The same persisted facts govern completion from UI, list moves, API and AI. */
export function completionBlockReason(task: Task, tasks: readonly Task[]): string | null {
  if (task.isArchived || task.isAbandoned) return 'アーカイブ・中止した仕事は完了できません。';
  if (task.taskKind === 'review_request') return '確認依頼には「確認OK」または「修正が必要」で返答してください。';
  // Subtasks are check items. Old descriptions, workflow and checklist records remain readable.
  if (task.parentTaskId) return null;
  if (task.workState) return '保留・待ちを解除してから完了してください。';
  if (taskBlockers(task, tasks).length) return '前提の仕事が未完了、または未取得です。';
  if (parentReviews(task, tasks).some(t => !t.isCompleted)) return '確認・修正の返答が残っています。';
  if (task.completionPolicy && !requiredChildrenState(task, [...tasks])?.complete) return '全員分の完了条件を確認してください。';
  return null;
}
