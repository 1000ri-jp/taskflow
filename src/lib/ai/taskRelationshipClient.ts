import { getAuthHeaders } from '@/lib/firebase/authToken';
import type { AIProviderType } from '@/types/ai';
import type { TaskRelationshipReport } from './taskRelationshipTypes';

export async function requestTaskRelationships(projectId: string, provider: AIProviderType, model: string, signal: AbortSignal): Promise<TaskRelationshipReport> {
  const response = await fetch('/api/ai/task-relations', {
    method: 'POST', headers: await getAuthHeaders(), signal,
    body: JSON.stringify({ projectId, provider, model }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : '候補を取得できませんでした。もう一度お試しください。');
  if (result?.projectId !== projectId || !Array.isArray(result.suggestions)) throw new Error('候補を確認できませんでした。もう一度お試しください。');
  return result;
}
