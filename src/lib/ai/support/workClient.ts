import { getAuthHeaders } from '@/lib/firebase/authToken';
import { getFirebaseAuth } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { workSupportContext, type WorkPreparation } from './workContext';
import type { AIProviderType } from '@/types/ai';
import type { Task } from '@/types';
export async function requestWorkSupport(uid: string, projectId: string, taskId: string, provider: AIProviderType, model: string, once = ''): Promise<WorkPreparation> {
  if (isE2EMockAuthEnabled()) {
    const { readOrganizationMock } = await import('@/lib/task/organizationMock');
    const tasks = Object.entries(readOrganizationMock(projectId).data.tasks).map(([id, task]) => ({ ...task, id }) as unknown as Task);
    const task = tasks.find(t => t.id === taskId); if (!task) throw new Error('架空の仕事を確認できません。');
    const context = workSupportContext(task, tasks, uid);
    return { text: `表示確認用：${context.intent}。${context.review?.request ?? context.work.completionCriteria ?? '依頼内容を確認してください。'}`, role: context.role, intent: context.intent, preparedAt: new Date().toISOString(), mock: true };
  }
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('アカウントを確認してください。');
  const headers = await getAuthHeaders();
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('アカウントが切り替わりました。');
  const response = await fetch('/api/ai/support/work', { method: 'POST', headers, body: JSON.stringify({ projectId, taskId, provider, model, once }) });
  const data = await response.json();
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('アカウントが切り替わりました。');
  if (!response.ok) throw new Error(data.error || '整理できませんでした。');
  return data;
}
