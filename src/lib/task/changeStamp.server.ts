import { FieldValue } from 'firebase-admin/firestore';
import { isTaskWritePath, TASK_CHANGE_FIELD } from './changeStamp';

/** Atomic database REQUEST_TIME transform; independent of the application clock. */
export function stampTaskWrite<T extends object>(reference: { path: string }, data: T): T {
  return isTaskWritePath(reference.path) ? { ...data, [TASK_CHANGE_FIELD]: FieldValue.serverTimestamp() } : data;
}
