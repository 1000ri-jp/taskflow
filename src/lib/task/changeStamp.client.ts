import { serverTimestamp } from 'firebase/firestore';
import { isTaskWritePath, TASK_CHANGE_FIELD } from './changeStamp';

/** First-party task writes use the same DB commit marker as server writes. */
export function stampTaskWrite<T extends object>(reference: { path: string }, data: T): T {
  return isTaskWritePath(reference.path) ? { ...data, [TASK_CHANGE_FIELD]: serverTimestamp() } : data;
}
