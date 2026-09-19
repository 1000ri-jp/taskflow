// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const backend = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('@/lib/board/autoArchiveRepository', () => ({ runAutoArchiveBatch: backend.batch }));
const secret = 'synthetic-job-secret-with-at-least-32-characters';
const request = (authorization: string | null = `Bearer ${secret}`, cursor?: string, body?: unknown) => new NextRequest(`http://localhost/api/jobs/task-auto-archive${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { method: 'POST', headers: authorization ? { Authorization: authorization } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('TASK_AUTOMATION_JOB_SECRET', secret);
  backend.batch.mockResolvedValue({ checked: 2, archived: 5, failed: 0, nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('automatic archive scheduled job boundary', () => {
  it.each(['', 'too-short'])('requires the existing strong job secret (%s)', async value => {
    vi.stubEnv('TASK_AUTOMATION_JOB_SECRET', value);
    expect((await POST(request())).status).toBe(503);
    expect(backend.batch).not.toHaveBeenCalled();
  });

  it.each([null, 'Bearer incorrect', `Bearer ${'x'.repeat(secret.length)}`, `Bearer ${'é'.repeat(secret.length)}`])('rejects unauthorized credentials before scanning projects', async authorization => {
    expect((await POST(request(authorization))).status).toBe(401);
    expect(backend.batch).not.toHaveBeenCalled();
  });

  it('passes only its project cursor, ignoring supplied policies, user IDs, or target tasks', async () => {
    const result = await POST(request(`Bearer ${secret}`, 'projects/project-20', { enabled: true, days: 1, uid: 'someone', taskIds: ['private'] }));
    expect(result.status).toBe(200);
    expect(backend.batch).toHaveBeenCalledExactlyOnceWith('projects/project-20');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual({ checked: 2, archived: 5, failed: 0, nextCursor: null });
  });

  it('leaves missing-policy no-op results unchanged and does not require the display-only scheduled flag', async () => {
    vi.stubEnv('TASK_AUTOMATION_SCHEDULED', 'false');
    backend.batch.mockResolvedValue({ checked: 0, archived: 0, failed: 0, nextCursor: null });
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(backend.batch).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(await result.json()).toEqual({ checked: 0, archived: 0, failed: 0, nextCursor: null });
  });

  it('returns a retryable failure without exposing database errors or credentials', async () => {
    backend.batch.mockRejectedValue(new Error(`projects/private failed with ${secret}`));
    const result = await POST(request());
    expect(result.status).toBe(503);
    const body = JSON.stringify(await result.json());
    expect(body).not.toContain(secret);
    expect(body).not.toContain('projects/private');
  });
});
