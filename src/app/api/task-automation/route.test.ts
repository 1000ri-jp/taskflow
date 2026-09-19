// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { AutomationError } from '@/lib/task/automationRepository';

const backend = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), run: vi.fn(), save: vi.fn(), policy: vi.fn(), reminder: vi.fn(), undo: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: backend.auth }));
vi.mock('@/lib/task/automationRepository', () => ({
  AutomationError: class AutomationError extends Error { constructor(message: string, public status = 422) { super(message); } },
  readAutomation: backend.read, runTaskAutomation: backend.run, saveAutomationRule: backend.save,
  saveCompletionPolicy: backend.policy, changeAutomationReminder: backend.reminder, undoAutomation: backend.undo,
}));
const expectedUpdatedAt = '2026-09-12T00:00:00.000Z';
const request = (body?: unknown, raw?: string) => new NextRequest('http://localhost/api/task-automation', { method: body === undefined && raw === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer synthetic-token' }, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks(); backend.auth.mockResolvedValue({ uid: 'u', email: 'person@1000ri.jp' });
  for (const method of [backend.read, backend.run, backend.save, backend.policy, backend.reminder, backend.undo]) method.mockResolvedValue({ revision: 1, grants: [], reminders: [] });
});

describe('task automation authenticated API', () => {
  it('requires a verified company identity even for a localhost request', async () => {
    backend.auth.mockRejectedValue(new Error('invalid token'));
    expect((await GET(request())).status).toBe(401); expect(backend.read).not.toHaveBeenCalled();
    expect((await POST(request({ action: 'run' }))).status).toBe(401); expect(backend.run).not.toHaveBeenCalled();
  });
  it.each(['outsider@example.test', 'person@evil1000ri.jp', 'person@1000ri.jp.attacker.test', undefined])('rejects a non-company email %s', async email => {
    backend.auth.mockResolvedValue({ uid: 'u', email });
    expect((await GET(request())).status).toBe(403); expect(backend.read).not.toHaveBeenCalled();
  });
  it('reads only the authenticated user’s settings and disallows cached private state', async () => {
    const response = await GET(request());
    expect(backend.auth).toHaveBeenCalledWith('Bearer synthetic-token'); expect(backend.read).toHaveBeenCalledWith('u');
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
  it('runs only server-read evidence and rejects arbitrary identities or evidence in the request', async () => {
    for (const extra of [{ uid: 'v' }, { evidence: [{ text: '購入完了' }] }, { sourceText: '購入完了' }, { patch: { isCompleted: true } }]) {
      expect((await POST(request({ action: 'run', ...extra }))).status).toBe(422);
    }
    expect(backend.run).not.toHaveBeenCalled();
    const response = await POST(request({ action: 'run' })); expect(response.status).toBe(200); expect(backend.run).toHaveBeenCalledExactlyOnceWith('u');
  });
  it('binds rule saving to the authenticated uid and exact supplied revision', async () => {
    const rule = { projectId: 'p', taskId: 'self', enabled: true, sources: ['comment'], subject: '展示会', period: '2026', person: '本人', sender: '', criterion: 'purchase', allowExpectedDate: false };
    const response = await POST(request({ action: 'save', uid: 'untrusted-user', rule, revision: 3 }));
    expect(response.status).toBe(200); expect(backend.save).toHaveBeenCalledWith('u', rule, 3);
  });
  it('passes all-child policy and reminder actions through the existing authenticated repository', async () => {
    const policy = { condition: '全員が購入した', required: [{ taskId: 'child', assigneeId: 'u' }] };
    expect((await POST(request({ action: 'policy', projectId: 'p', taskId: 'parent', policy, expectedUpdatedAt }))).status).toBe(200);
    expect(backend.policy).toHaveBeenCalledWith('u', 'p', 'parent', policy, expectedUpdatedAt);
    expect((await POST(request({ action: 'policy', projectId: 'p', taskId: 'parent', policy: null, expectedUpdatedAt }))).status).toBe(200);
    expect(backend.policy).toHaveBeenLastCalledWith('u', 'p', 'parent', null, expectedUpdatedAt);
    expect((await POST(request({ action: 'reminder', projectId: 'p', taskId: 'parent', until: '2026-09-13T03:00:00Z' }))).status).toBe(200);
    expect(backend.reminder).toHaveBeenCalledWith('u', 'p', 'parent', '2026-09-13T03:00:00Z');
    expect((await POST(request({ action: 'reminder', projectId: 'p', taskId: 'parent', until: null }))).status).toBe(200);
    expect(backend.reminder).toHaveBeenLastCalledWith('u', 'p', 'parent', null);
  });
  it('passes record-level undo with its current revision and rejects malformed destinations', async () => {
    expect((await POST(request({ action: 'undo', projectId: 'p', taskId: 'self', recordId: 'r1', revision: 4 }))).status).toBe(200);
    expect(backend.undo).toHaveBeenCalledWith('u', 'p', 'self', 'r1', 4);
    backend.undo.mockClear();
    for (const input of [{ projectId: 'p/other' }, { taskId: '' }, { revision: '4' }, { recordId: 42 }]) {
      expect((await POST(request({ action: 'undo', projectId: 'p', taskId: 'self', recordId: 'r1', revision: 4, ...input }))).status).toBe(422);
    }
    expect(backend.undo).not.toHaveBeenCalled();
  });
  it('rejects oversized, malformed, array and unknown operation payloads before executing', async () => {
    for (const raw of ['{', 'null', '[]', JSON.stringify({ action: 'unknown' }), JSON.stringify({ action: 'run', text: 'x'.repeat(12001) })]) expect((await POST(request(undefined, raw))).status).toBe(422);
    expect(backend.run).not.toHaveBeenCalled(); expect(backend.save).not.toHaveBeenCalled(); expect(backend.policy).not.toHaveBeenCalled();
  });
  it('keeps permission/version conflicts distinct and hides internal acquisition failures', async () => {
    backend.run.mockRejectedValue(new AutomationError('権限が失効しました', 403)); expect((await POST(request({ action: 'run' }))).status).toBe(403);
    backend.run.mockRejectedValue(new AutomationError('他者の編集があります', 409)); expect((await POST(request({ action: 'run' }))).status).toBe(409);
    backend.run.mockRejectedValue(new Error('private token=secret-value'));
    const response = await POST(request({ action: 'run' })); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('secret-value');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('requires the parent version for both policy changes and removals', async () => {
    for (const policy of [null, { condition: '全員完了', required: [{ taskId: 'child', assigneeId: 'u' }] }]) {
      expect((await POST(request({ action: 'policy', projectId: 'p', taskId: 'parent', policy }))).status).toBe(409);
    }
    expect(backend.policy).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true, 0, '', [], {}, { condition: 12, required: [] }, { condition: ' ', required: [{ taskId: 'child', assigneeId: 'u' }] }, { condition: '全員完了', required: [null] }, { condition: '全員完了', required: [{ taskId: 'child' }] }, { condition: '全員完了', required: [{ taskId: 'child', assigneeId: 'u' }, { taskId: 'child2', assigneeId: 'u' }] }])('rejects malformed policies instead of treating them as removal: %j', async policy => {
    expect((await POST(request({ action: 'policy', projectId: 'p', taskId: 'parent', policy, expectedUpdatedAt }))).status).toBe(422);
    expect(backend.policy).not.toHaveBeenCalled();
  });
  it('forwards only the user-configurable policy fields', async () => {
    const policy = { condition: '全員完了', required: [{ taskId: 'child', assigneeId: 'u', ignored: true }], completedByAutomation: true, completedVersion: 'untrusted-version', grantedBy: 'other' };
    expect((await POST(request({ action: 'policy', projectId: 'p', taskId: 'parent', policy, expectedUpdatedAt }))).status).toBe(200);
    expect(backend.policy).toHaveBeenCalledWith('u', 'p', 'parent', { condition: policy.condition, required: [{ taskId: 'child', assigneeId: 'u' }] }, expectedUpdatedAt);
  });
});
