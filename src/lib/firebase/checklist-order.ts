import { doc, runTransaction } from 'firebase/firestore';
import { getFirebaseDb } from './config';
import { moveChecklistItem } from '@/lib/utils/checklist';
import type { ChecklistItem } from '@/types';

export async function reorderChecklistItem(
  projectId: string, taskId: string, checklistId: string, itemId: string, targetId: string,
): Promise<ChecklistItem[]> {
  const db = getFirebaseDb();
  const reference = doc(db, 'projects', projectId, 'tasks', taskId, 'checklists', checklistId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('チェックリストが見つかりません。タスクを開き直してください。');
    const items = snapshot.data().items as ChecklistItem[];
    if (!Array.isArray(items)) throw new Error('チェックリストを読み込めませんでした。');
    const reordered = moveChecklistItem(items, itemId, targetId);
    if (itemId !== targetId) transaction.update(reference, { items: reordered });
    return reordered;
  });
}
