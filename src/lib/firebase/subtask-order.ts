import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { getFirebaseDb } from './config';
import { getTaskSubtasks } from '@/lib/task/subtasks';
import type { Task } from '@/types';

export async function reorderTaskSubtasks(
  projectId: string,
  parentTaskId: string,
  expectedIds: string[],
  orderedIds: string[],
): Promise<void> {
  assertUniqueIds(expectedIds);
  assertUniqueIds(orderedIds);
  if (expectedIds.length !== orderedIds.length || expectedIds.some(id => !orderedIds.includes(id))) {
    throw new Error('サブタスクが変更されています。タスクを開き直してから並べ替えてください。');
  }

  const db = getFirebaseDb();
  const parentRef = doc(db, 'projects', projectId, 'tasks', parentTaskId);
  const siblings = await getDocs(query(
    collection(db, 'projects', projectId, 'tasks'),
    where('parentTaskId', '==', parentTaskId),
  ));
  const childRefs = siblings.docs.map(snapshot => doc(db, 'projects', projectId, 'tasks', snapshot.id));

  await runTransaction(db, async transaction => {
    const parentSnapshot = await transaction.get(parentRef);
    if (!parentSnapshot.exists()) throw new Error('親タスクが見つかりません。タスクを開き直してください。');
    const childSnapshots = await Promise.all(childRefs.map(reference => transaction.get(reference)));
    const parent = { ...parentSnapshot.data(), id: parentTaskId } as Task;
    if (parent.projectId !== projectId || parent.isArchived) throw new Error('親タスクを確認できません。タスクを開き直してください。');
    const children = childSnapshots.flatMap(snapshot => snapshot.exists()
      ? [{ ...snapshot.data(), id: snapshot.id } as Task]
      : []);
    const currentIds = getTaskSubtasks(parent, children).map(item => item.id);
    if (currentIds.length !== expectedIds.length || currentIds.some((id, index) => id !== expectedIds[index])) {
      throw new Error('サブタスクが変更されています。タスクを開き直してから並べ替えてください。');
    }

    const oldOrder = Array.isArray(parent.subtaskOrderIds) ? parent.subtaskOrderIds : [];
    const hiddenIds = oldOrder.filter(id => !currentIds.includes(id));
    const nextOrder = [...orderedIds, ...hiddenIds.filter(id => !orderedIds.includes(id))];
    if (oldOrder.length === nextOrder.length && oldOrder.every((id, index) => id === nextOrder[index])) return;
    transaction.update(parentRef, { subtaskOrderIds: nextOrder });
  });
}

function assertUniqueIds(ids: string[]) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('サブタスクの順序を確認できません。');
  }
}
