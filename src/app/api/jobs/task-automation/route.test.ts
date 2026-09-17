// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
const backend = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('@/lib/task/automationRepository', () => ({ runAutomationBatch: backend.batch }));
const secret = 'synthetic-job-secret-with-at-least-32-characters';
const request = (authorization: string | null = `Bearer ${secret}`, cursor?: string, body?: unknown) => new NextRequest(`http://localhost/api/jobs/task-automation${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { method: 'POST', headers: authorization ? { Authorization: authorization } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('TASK_AUTOMATION_JOB_SECRET', secret); backend.batch.mockResolvedValue({ checked: 2, failed: 0, nextCursor: null }); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('task automation background job boundary', () => {
  it.each(['', 'too-short'])('cannot run without a configured strong job secret (%s)', async value => {
    vi.stubEnv('TASK_AUTOMATION_JOB_SECRET', value); expect((await POST(request())).status).toBe(503); expect(backend.batch).not.toHaveBeenCalled();
  });
  it.each([null, 'Bearer incorrect', `Bearer ${'x'.repeat(secret.length)}`, `Bearer ${'é'.repeat(secret.length)}`])('rejects an unauthorized credential without running a batch', async authorization => {
    expect((await POST(request(authorization))).status).toBe(401); expect(backend.batch).not.toHaveBeenCalled();
  });
  it('passes only a validated-by-repository cursor and never arbitrary user/evidence payloads', async () => {
    const cursor = 'users/u/secretary/task-automation';
    const response = await POST(request(`Bearer ${secret}`, cursor, { uid: 'someone', evidence: [{ text: '購入完了' }], isCompleted: true }));
    expect(response.status).toBe(200); expect(backend.batch).toHaveBeenCalledExactlyOnceWith(cursor); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ checked: 2, failed: 0, nextCursor: null });
  });
  it('returns a retryable failure without exposing service errors or credentials', async () => {
    backend.batch.mockRejectedValue(new Error(`Database failure with ${secret}`));
    const response = await POST(request()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain(secret);
  });
});
