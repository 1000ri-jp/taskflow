// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, POST } from './route';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
const mock = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), act: vi.fn(), save: vi.fn(), interpret: vi.fn(), incoming: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mock.auth }));
vi.mock('@/lib/ai/providers', () => ({ isValidProvider: (p: string) => ['openai', 'anthropic', 'gemini'].includes(p) }));
vi.mock('@/lib/secretary/repository', () => ({ readSecretary: mock.read, actOnSecretary: mock.act, saveReview: mock.save }));
vi.mock('@/lib/secretary/interpret', () => ({ interpretSnapshot: mock.interpret }));
vi.mock('@/lib/secretary/interpretIncoming', () => ({ interpretIncoming: mock.incoming }));
vi.mock('@/lib/secretary/engine', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/secretary/engine')>(), mergeReview: vi.fn() }));
const req = (method = 'GET', body?: unknown) => new NextRequest('http://localhost/api/secretary', { method, headers: { Authorization: 'Bearer synthetic-token' }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { vi.resetAllMocks(); mock.auth.mockResolvedValue({ uid: 'u', email: 'test@1000ri.jp' }); });
describe('Secretary authenticated API', () => {
  it('requires real Firebase auth even on localhost (no server mock bypass)', async () => {
    mock.auth.mockRejectedValue(new Error('invalid'));
    expect((await GET(req())).status).toBe(401); expect(mock.read).not.toHaveBeenCalled();
  });
  it('rejects a different domain', async () => {
    mock.auth.mockResolvedValue({ uid: 'u', email: 'test@example.com' });
    expect((await GET(req())).status).toBe(403);
  });
  it('rejects client supplied sources, user id, policy and tool permissions', async () => {
    for (const key of ['context', 'userId', 'systemPrompt', 'enableTools']) expect((await POST(req('POST', { provider: 'openai', [key]: 'injected' }))).status).toBe(422);
    expect(mock.interpret).not.toHaveBeenCalled();
  });
  it('derives evidence and persistence preconditions only from server reads', async () => {
    const view = { snapshot: { signature: 'server' }, state: { revision: 7 } }; mock.read.mockResolvedValue(view); mock.interpret.mockResolvedValue([]); mock.save.mockResolvedValue({ saved: true });
    const result = await POST(req('POST', { provider: 'openai', model: 'existing-model' }));
    expect(result.status).toBe(200); expect(mock.save).toHaveBeenCalledWith('u', { revision: 7, signature: 'server' }, []);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects arbitrary task changes and malformed revision', async () => {
    expect((await PATCH(req('PATCH', { action: 'complete', proposalId: 'p', revision: 0, patch: { assigneeIds: ['v'] } }))).status).toBe(422);
    expect((await PATCH(req('PATCH', { action: 'accept', proposalId: 'p', revision: '0' }))).status).toBe(422);
    expect(mock.act).not.toHaveBeenCalled();
  });
  it('passes an explicit deadline to the existing authenticated transaction without invoking AI', async () => {
    const input = { action: 'reschedule', proposalId: 'proposal-1', revision: 4, dueDate: '2026-09-21' };
    mock.act.mockResolvedValue({ saved: true });
    const result = await PATCH(req('PATCH', input));
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(mock.act).toHaveBeenCalledWith('u', input);
    expect(mock.interpret).not.toHaveBeenCalled(); expect(mock.incoming).not.toHaveBeenCalled();
  });
  it('requires a valid calendar date only for the explicit reschedule action', async () => {
    for (const dueDate of [undefined, null, '', '2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-9-21', '2026-09-21T00:00:00Z', 20260921]) {
      expect((await PATCH(req('PATCH', { action: 'reschedule', proposalId: 'p', revision: 0, dueDate }))).status).toBe(422);
    }
    expect((await PATCH(req('PATCH', { action: 'next_week', proposalId: 'p', revision: 0, dueDate: '2026-09-21' }))).status).toBe(422);
    expect(mock.act).not.toHaveBeenCalled();
  });
  it('reports acquisition failure distinctly from empty', async () => {
    mock.read.mockRejectedValue(new Error('backend unavailable'));
    const result = await GET(req()); expect(result.status).toBe(503); expect((await result.json()).code).toBe('UNAVAILABLE');
  });
  it('reviews changed incoming evidence with server scope and reuses the unchanged result', async () => {
    const now = new Date().toISOString();
    const view = { snapshot: { signature: 'tasks', checkedAt: now, incoming: { signature: 'mail-v1', sources: { gmail: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now }, chat: emptyGoogleSource() } } }, state: { revision: 1 } };
    mock.read.mockResolvedValue(view); mock.interpret.mockResolvedValue([]); mock.incoming.mockResolvedValue([]); mock.save.mockResolvedValue({ saved: true });
    expect((await POST(req('POST', { provider: 'gemini' }))).status).toBe(200);
    expect(mock.save).toHaveBeenLastCalledWith('u', { revision: 1, signature: 'tasks' }, [], { signature: 'mail-v1', raw: [] });
    expect(mock.incoming).toHaveBeenCalledTimes(1);
    mock.read.mockResolvedValue({ ...view, state: { ...view.state, incomingReview: { signature: 'mail-v1' } } });
    expect((await POST(req('POST', { provider: 'gemini' }))).status).toBe(200);
    expect(mock.incoming).toHaveBeenCalledTimes(1);
  });
  it('keeps successful task review when incoming fails, and reports the partial result', async () => {
    const now = new Date().toISOString();
    mock.read.mockResolvedValue({ snapshot: { signature: 'tasks', checkedAt: now, incoming: { signature: 'new', sources: { gmail: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now }, chat: emptyGoogleSource() } } }, state: { revision: 1 } });
    mock.interpret.mockResolvedValue([]); mock.incoming.mockRejectedValue(new Error('failed'));
    mock.save.mockResolvedValue({ saved: true });
    const response = await POST(req('POST', { provider: 'gemini' }));
    expect(response.status).toBe(200); expect((await response.json()).reviewWarnings).toEqual(['メール・ChatのAI整理は完了しませんでした。今回の連絡は未確認です。']);
    expect(mock.save).toHaveBeenCalledWith('u', { revision: 1, signature: 'tasks' }, []);
  });
  it('skips AI and writes when both reviews are already current', async () => {
    mock.read.mockResolvedValue({ snapshot: { signature: 'tasks', checkedAt: new Date().toISOString(), tasks: [] }, state: { reviewPolicyVersion: 2, reviewedAt: new Date().toISOString(), proposals: [], observedSignature: 'tasks', decisions: [] } });
    expect((await POST(req('POST', { provider: 'gemini' }))).status).toBe(200);
    expect(mock.interpret).not.toHaveBeenCalled(); expect(mock.incoming).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  });
  it('keeps successful incoming review when tasks fail and makes no write if both fail', async () => {
    const now = new Date().toISOString();
    mock.read.mockResolvedValue({ snapshot: { signature: 'tasks', checkedAt: now, incoming: { signature: 'new', sources: { gmail: { ...emptyGoogleSource(), connected: true, status: 'ready', fetchedAt: now }, chat: emptyGoogleSource() } } }, state: { revision: 1 } });
    mock.interpret.mockRejectedValue(new Error('task failed')); mock.incoming.mockResolvedValue([]); mock.save.mockResolvedValue({ saved: true });
    expect((await POST(req('POST', { provider: 'gemini' }))).status).toBe(200);
    expect(mock.save).toHaveBeenCalledWith('u', { revision: 1, signature: 'tasks' }, undefined, { signature: 'new', raw: [] });
    mock.save.mockClear(); mock.incoming.mockRejectedValue(new Error('incoming failed'));
    expect((await POST(req('POST', { provider: 'gemini' }))).status).toBe(503); expect(mock.save).not.toHaveBeenCalled();
  });
});

it('accepts only versioned manual deadline or personal dismissal actions',async()=>{
 mock.act.mockResolvedValue({saved:true});
 const input={action:'unneeded',proposalId:'manual-001',revision:1,taskKey:'project/task',sourceVersion:'read-version'};
 expect((await PATCH(req('PATCH',input))).status).toBe(200);
 expect((await PATCH(req('PATCH',{...input,action:'complete'}))).status).toBe(422);
 expect((await PATCH(req('PATCH',{...input,sourceVersion:undefined}))).status).toBe(422);
});
