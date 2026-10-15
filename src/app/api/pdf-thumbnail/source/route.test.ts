// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { PdfAttachmentReadError } from '@/lib/pdf/readAttachmentPdf';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/authenticateRequest', () => ({ authenticateRequest: mocks.auth }));
vi.mock('@/lib/auth/projectAccess', () => ({ getProjectAccess: mocks.access }));
vi.mock('@/lib/pdf/readAttachmentPdf', () => ({
  readAttachmentPdf: mocks.read,
  PdfAttachmentReadError: class extends Error { constructor(message: string, public status = 503) { super(message); } },
}));

const source = { kind: 'comment', projectId: 'project', taskId: 'task', commentId: 'comment', attachmentId: 'attachment' };
const bytes = new TextEncoder().encode('%PDF-1.7\nFictitious PDF test bytes.');
const request = (body: unknown = source, extra: RequestInit = {}, query = '') => new Request(`http://localhost/api/pdf-thumbnail/source${query}`, {
  method: 'POST', headers: { Authorization: 'Bearer tf_scoped-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user', permissions: ['tasks:read'], projectIds: ['project'], authType: 'api-token' });
  mocks.access.mockResolvedValue({ role: 'viewer' });
  mocks.read.mockResolvedValue(bytes);
});

describe('POST /api/pdf-thumbnail/source', () => {
  it('authenticates, retains PAT constraints and checks project access before reading registered bytes', async () => {
    const input = request(); const response = await POST(input);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.auth).toHaveBeenCalledWith('Bearer tf_scoped-token');
    expect(mocks.access).toHaveBeenCalledWith('user', 'project', ['tasks:read'], ['project'], 'tasks:read');
    expect(mocks.read).toHaveBeenCalledWith(source, input.signal);
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.access.mock.invocationCallOrder[0]);
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
  });

  it('uses Firebase user identity with the existing project permission check', async () => {
    mocks.auth.mockResolvedValueOnce({ userId: 'user', permissions: null, projectIds: null, authType: 'firebase' });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith('user', 'project', null, null, 'tasks:read');
  });

  it('does not read request bodies or files before authentication', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('private auth cause'));
    const input = request(); const response = await POST(input);
    expect(response.status).toBe(401); expect(input.bodyUsed).toBe(false);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private auth cause');
  });

  it.each(['FORBIDDEN', 'NOT_FOUND'])('does not resolve metadata after project access rejects with %s', async error => {
    mocks.access.mockRejectedValueOnce(new Error(error));
    expect((await POST(request())).status).toBe(error === 'FORBIDDEN' ? 403 : 404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    { ...source, url: 'https://private.test/token' },
    { ...source, referenceId: 'reference' },
    { ...source, attachmentId: '..' },
    { ...source, taskId: 'other/task' },
  ])('rejects arbitrary URLs and unsafe or ambiguous metadata locators: %j', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects query parameters and unsupported body formats', async () => {
    expect((await POST(request(source, {}, '?url=https://private.test'))).status).toBe(400);
    expect((await POST(request(source, { headers: { 'Content-Type': 'text/plain' } }))).status).toBe(400);
    expect((await POST(request(source, { body: '{bad-json' }))).status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('bounds actual JSON request bytes even without Content-Length', async () => {
    const response = await POST(request('x'.repeat(16 * 1024)));
    expect(response.status).toBe(413);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared body before reading it', async () => {
    const input = request(source, { headers: { 'Content-Type': 'application/json', 'Content-Length': '100000' } });
    expect((await POST(input)).status).toBe(413); expect(input.bodyUsed).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns controlled PDF errors and masks unexpected database or network causes', async () => {
    mocks.read.mockRejectedValueOnce(new PdfAttachmentReadError('添付ファイルが見つかりません。', 404));
    expect((await POST(request())).status).toBe(404);
    mocks.read.mockRejectedValueOnce(new Error('https://private.test?token=secret server-path'));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.text();
    expect(body).not.toContain('private.test'); expect(body).not.toContain('secret'); expect(body).not.toContain('server-path');
  });
});
