import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentSubmission } from '@/lib/task/commentSubmission';
vi.mock('./testMode', () => ({ isE2EMockAuthEnabled: () => false }));
vi.mock('./authToken', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer test' }) }));
import { submitTaskComment } from './commentSubmission';
const fetcher = vi.fn();
const input = (changes: Partial<CommentSubmission> = {}): CommentSubmission => ({ id: 'intent', projectId: 'p', taskId: 'parent', authorId: 'author', authorName: 'Kozue', content: '見てください', notifyIds: [], review: null, attachments: [], ...changes });
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); });
describe('shared comment submission boundary', () => {
  it('sends the original intent and purpose to the authenticated parent endpoint', async () => {
    fetcher.mockResolvedValue({ok:true,json:async()=>({commentId:'intent',reviewTaskId:'review-intent',alreadySubmitted:false})});
    const request=input({purpose:'review_request',review:{content:'強度を確認',assigneeIds:['reviewer'],dueDate:null}});
    expect(await submitTaskComment(request)).toMatchObject({reviewTaskId:'review-intent'});
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p/tasks/parent/comments',expect.objectContaining({headers:{Authorization:'Bearer test'},body:JSON.stringify({submission:request})}));
  });
  it('retains the same intent across an uncertain response and a recovered receipt', async () => {
    fetcher.mockRejectedValueOnce(new Error('ack lost')).mockResolvedValueOnce({ok:true,json:async()=>({commentId:'intent',reviewTaskId:null,alreadySubmitted:true})});
    const request=input(); await expect(submitTaskComment(request)).rejects.toThrow('ack lost');
    expect((await submitTaskComment(request)).alreadySubmitted).toBe(true);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it('distinguishes explicit rejection from uncertain failure', async () => {
    fetcher.mockResolvedValueOnce({ok:false,json:async()=>({rejected:true,error:'権限を確認'})});
    await expect(submitTaskComment(input())).rejects.toMatchObject({code:'submission-rejected'});
    fetcher.mockResolvedValueOnce({ok:false,json:async()=>({error:'offline'})});
    await expect(submitTaskComment(input())).rejects.not.toHaveProperty('code');
  });
  it('rejects invalid purposes before transmission',async()=>{
    await expect(submitTaskComment(input({purpose:'other' as 'memo'}))).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
});
