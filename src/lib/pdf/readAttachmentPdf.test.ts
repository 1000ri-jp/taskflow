// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAttachmentPdf } from './readAttachmentPdf';
import type { PdfThumbnailSource } from './attachmentSource';

const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => reference() }));

function reference(path = '') {
  return {
    collection: (name: string) => reference(path ? `${path}/${name}` : name),
    doc: (id: string) => reference(`${path}/${id}`),
    get: () => mocks.get(path),
  };
}

const bucket = 'fictitious-taskflow.appspot.com';
const token = 'existing-download-token';
const urlFor = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
const savedUrl = urlFor('projects/original-project/tasks/original-task/comment_attachments/会場案内.pdf');
const pdf = new TextEncoder().encode('%PDF-1.7\nFictitious PDF source bytes for tests only.');
const base = { projectId: 'current-project', attachmentId: 'attachment' };
const documents = new Map<string, Record<string, unknown>>();

function fixture(kind: PdfThumbnailSource['kind'] = 'task'): PdfThumbnailSource {
  const attachment = { id: base.attachmentId, name: '会場案内.pdf', type: 'application/pdf', size: pdf.byteLength, url: savedUrl };
  if (kind === 'task' || kind === 'comment') {
    const parent = `projects/${base.projectId}/tasks/task`;
    documents.set(parent, {});
    if (kind === 'task') {
      documents.set(`${parent}/attachments/${base.attachmentId}`, attachment);
      return { ...base, kind, taskId: 'task' };
    }
    documents.set(`${parent}/comments/comment`, { attachments: [attachment] });
    return { ...base, kind, taskId: 'task', commentId: 'comment' };
  }
  const parent = `projects/${base.projectId}/references/reference`;
  documents.set(parent, { attachments: kind === 'reference' ? [attachment] : [] });
  if (kind === 'reference') return { ...base, kind, referenceId: 'reference' };
  documents.set(`${parent}/comments/comment`, { attachments: [attachment] });
  return { ...base, kind, referenceId: 'reference', commentId: 'comment' };
}
const taskAttachment = () => documents.get(`projects/${base.projectId}/tasks/task/attachments/${base.attachmentId}`)!;

beforeEach(() => {
  vi.resetAllMocks();
  documents.clear();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', bucket);
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.get.mockImplementation(async (path: string) => ({ exists: documents.has(path), data: () => documents.get(path) }));
  mocks.fetch.mockImplementation(async () => new Response(pdf));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('registered PDF source lookup and existing download capability', () => {
  it.each(['task', 'comment', 'reference', 'reference-comment'] as const)(
    'resolves %s metadata and retains a moved/converted source URL', async kind => {
      expect(await readAttachmentPdf(fixture(kind))).toEqual(pdf);
      expect(mocks.get.mock.calls[0][0]).toBe(`projects/${base.projectId}/${kind.startsWith('reference') ? 'references/reference' : 'tasks/task'}`);
      expect(mocks.fetch).toHaveBeenCalledWith(savedUrl, {
        method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal),
      });
      expect(mocks.fetch.mock.calls[0][1]).not.toHaveProperty('headers');
    },
  );

  it.each(['task', 'comment', 'reference', 'reference-comment'] as const)('requires the parent %s record before bytes are read', async kind => {
    const source = fixture(kind);
    documents.delete(`projects/${base.projectId}/${kind.startsWith('reference') ? 'references/reference' : 'tasks/task'}`);
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 404 });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not serve removed attachments or another attachment from the same comment', async () => {
    const source = fixture('comment');
    await expect(readAttachmentPdf({ ...source, attachmentId: 'different-id' })).rejects.toMatchObject({ status: 404 });
    documents.delete(`projects/${base.projectId}/tasks/task/comments/comment`);
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 404 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('accepts a PDF filename with generic MIME metadata and rejects non-PDF metadata', async () => {
    const source = fixture();
    Object.assign(taskAttachment(), { name: 'ARCHIVE.PDF', type: 'application/octet-stream' });
    expect(await readAttachmentPdf(source)).toEqual(pdf);
    Object.assign(taskAttachment(), { name: 'document.html', type: 'text/html' });
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 415 });
  });

  it.each([
    'https://example.test/file.pdf',
    savedUrl.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.attacker.test'),
    savedUrl.replace('https:', 'http:'),
    savedUrl.replace('https://', 'https://user:password@'),
    savedUrl.replace('.googleapis.com/', '.googleapis.com:444/'),
    savedUrl.replace(bucket, 'different-bucket.appspot.com'),
    `${savedUrl}&other=param`, `${savedUrl}&token=second-token`, `${savedUrl}#fragment`,
    savedUrl.replace('alt=media', 'alt=json'), savedUrl.replace(`&token=${token}`, ''),
    urlFor('projects/p/icon/file.pdf'), urlFor('users/u/attachments/file.pdf'),
    urlFor('projects/p/references/r/comment_attachments/file.pdf'),
    urlFor('projects/p/tasks/t/attachments/../private.pdf'),
    urlFor('projects/p/tasks/t/attachments/./private.pdf'),
    urlFor('projects/p/tasks/t/attachments/\0private.pdf'),
    urlFor('projects/p/tasks/t/attachments/..\\private.pdf'),
    urlFor('projects/p/tasks/t/attachments/'),
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/%invalid?alt=media&token=${token}`,
  ])('rejects unsupported hosts, buckets, paths and query parameters before fetch: %s', async url => {
    const source = fixture(); taskAttachment().url = url;
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('requires the configured bucket and never falls back to Admin Storage', async () => {
    const source = fixture(); vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', '');
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not follow redirects or expose upstream URLs and tokens in errors', async () => {
    const source = fixture();
    mocks.fetch.mockRejectedValueOnce(new Error(`redirect to https://private.test with ${savedUrl}`));
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 503, message: 'PDFを取得できませんでした。もう一度お試しください。' });
    const redirected = new Response(pdf); Object.defineProperty(redirected, 'redirected', { value: true });
    mocks.fetch.mockResolvedValueOnce(redirected);
    await expect(readAttachmentPdf(source)).rejects.toMatchObject({ status: 503 });
  });

  it.each([[403, 503], [404, 404], [500, 503]])('maps HTTP %s without returning the upstream body', async (upstream, status) => {
    mocks.fetch.mockResolvedValueOnce(new Response(savedUrl, { status: upstream }));
    await expect(readAttachmentPdf(fixture())).rejects.toMatchObject({ status });
  });
});

describe('bounded PDF byte reads', () => {
  it('checks actual streamed bytes even when Content-Length claims a small file', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel,
    }), { headers: { 'Content-Length': '1' } }));
    await expect(readAttachmentPdf(fixture())).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects an oversized declared response before consuming it', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) } }));
    await expect(readAttachmentPdf(fixture())).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });

  it.each(['', '<html>Not a PDF</html>', `garbage${'x'.repeat(1024)}%PDF-1.7`])('validates PDF signature before returning bytes: %j', async body => {
    mocks.fetch.mockResolvedValueOnce(new Response(body));
    await expect(readAttachmentPdf(fixture())).rejects.toMatchObject({ status: 415 });
  });

  it('bounds a stalled fetch to 15 seconds and aborts it', async () => {
    vi.useFakeTimers(); mocks.fetch.mockImplementationOnce(() => new Promise(() => {}));
    const reading = readAttachmentPdf(fixture());
    const result = expect(reading).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('bounds a stalled response body to the same deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel })));
    const reading = readAttachmentPdf(fixture());
    const result = expect(reading).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(cancel).toHaveBeenCalled();
  });

  it('stops an already cancelled request before database or Storage access', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readAttachmentPdf(fixture(), controller.signal)).rejects.toMatchObject({ status: 504 });
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
