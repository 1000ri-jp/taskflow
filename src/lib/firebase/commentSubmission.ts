import { isE2EMockAuthEnabled } from './testMode';
import { getAuthHeaders } from './authToken';
import { validateCommentSubmission, type CommentSubmission } from '@/lib/task/commentSubmission';
export class CommentSubmissionRejected extends Error { readonly code = 'submission-rejected'; }
export async function submitTaskComment(input: CommentSubmission) {
  validateCommentSubmission(input);
  if (isE2EMockAuthEnabled()) { const { submitTaskCommentMock } = await import('@/lib/task/detailMock'); return submitTaskCommentMock(input); }
  const response = await fetch(`/api/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.taskId)}/comments`, {
    method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ submission: input }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.rejected) throw new CommentSubmissionRejected(result.error);
    throw new Error(result.error || '送信結果を確認できません。同じ投稿を再試行してください。');
  }
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return result as { commentId: string; reviewTaskId: string | null; alreadySubmitted: boolean };
}
