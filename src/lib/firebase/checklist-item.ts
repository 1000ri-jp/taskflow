import { doc, runTransaction } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from './config';
import { assertChecklistItemScope, mutateChecklistItems, validateChecklistItemDueDate, type ChecklistItemMutation } from '@/lib/utils/checklist-item';
import type { ChecklistItem } from '@/types';

export async function mutateChecklistItem(
  projectId: string, taskId: string, checklistId: string, action: ChecklistItemMutation,
): Promise<ChecklistItem[]> {
  assertChecklistItemScope(projectId, taskId, checklistId);
  const mutation = action.kind === 'add' ? { ...action, item: { ...action.item } } : { ...action };
  if (mutation.kind === 'dueDate') validateChecklistItemDueDate(mutation.dueDate);
  const userId = getFirebaseAuth().currentUser?.uid;
  if (!userId) throw new Error('ログインし直してください。');
  const assertCurrentUser = () => {
    if (getFirebaseAuth().currentUser?.uid !== userId) throw new Error('ログイン状態が変わりました。タスクを開き直してください。');
  };
  const db = getFirebaseDb();
  const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);
  const checklistRef = doc(db, 'projects', projectId, 'tasks', taskId, 'checklists', checklistId);
  const result = await runTransaction(db, async transaction => {
    assertCurrentUser();
    const [taskSnapshot, checklistSnapshot] = await Promise.all([transaction.get(taskRef), transaction.get(checklistRef)]);
    assertCurrentUser();
    if (!taskSnapshot.exists()) throw new Error('タスクが見つかりません。タスクを開き直してください。');
    const task = taskSnapshot.data();
    if (task.isArchived) throw new Error('アーカイブ済みのタスクは変更できません。');
    if (task.projectId !== undefined && task.projectId !== projectId) throw new Error('タスクのプロジェクトが一致しません。');
    if (!checklistSnapshot.exists()) throw new Error('チェックリストが見つかりません。タスクを開き直してください。');
    const checklist = checklistSnapshot.data();
    if (checklist.taskId !== undefined && checklist.taskId !== taskId) throw new Error('チェックリストのタスクが一致しません。');
    const items = checklist.items as ChecklistItem[];
    const next = mutateChecklistItems(items, mutation);
    if (items.length !== next.length || next.some((item, index) => item !== items[index])) {
      transaction.update(checklistRef, { items: next });
    }
    return next;
  });
  assertCurrentUser();
  return result;
}
