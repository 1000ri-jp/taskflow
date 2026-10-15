import { test, expect, type Locator, type Page } from '@playwright/test';

const projectId = 'secretary-demo';
const taskId = 'thumbnail-task';
const commentId = 'thumbnail-comment';
const referenceId = 'thumbnail-reference';
const referenceCommentId = 'thumbnail-reference-comment';
const storageKey = `taskflow-organization-lab-v1:${projectId}`;
const sourcePath = '/api/pdf-thumbnail/source';
const assetBase = '/pdfjs/6.4.299/';
type Color = 'red' | 'blue';
type Source = Record<string, string>;
type Fixture = { id: string; name: string; url: string; type: string; size: number; bytes: Buffer; source: Source };
type ThumbnailProbe = { workers: string[]; terminated: string[]; workerErrors: string[]; violations: string[] };
type ProbeWindow = Window & { thumbnailProbe: ThumbnailProbe };
type Diagnostics = { unexpected: string[]; sources: Source[]; assets: string[]; consoleErrors: string[] };
const diagnostics = new WeakMap<Page, Diagnostics>();

// Original two-page fixture. Reversing the page colors also detects stale-file thumbnails.
function twoPagePdf(first: Color = 'red'): Buffer {
  const stream = (color: Color, label: string) => `q ${color === 'red' ? '1 0 0' : '0 0 1'} rg 0 0 320 240 re f Q BT /F1 22 Tf 1 1 1 rg 28 195 Td (${label}) Tj ET`;
  const firstStream = stream(first, 'FIRST PAGE');
  const secondStream = stream(first === 'red' ? 'blue' : 'red', 'SECOND PAGE');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(firstStream)} >>\nstream\n${firstStream}\nendstream`,
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

// Original blank encrypted PDF, verified with PDF.js 6.4.299 as NEED_PASSWORD (code 1).
function passwordProtectedPdf(): Buffer {
  return Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGIzZDY5MzcyNDU+Ci9UaXRsZSA8OGNkZDhhNzE0YWY3Y2YzNzQ5ZjIzMjM2ZWIyYTU1ZDBkNzU3ZGUzMmU3NjFjM2NmMDMyNjRmZDU5ZjQ5NTdlZTgxMGNjYjNjYTU4ZmU2ODQ+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMTIwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAxCi9SIDIKL0xlbmd0aCA0MAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDw3YmIzZTAyNmQ2ZTNhNTFkMWYyMGNlNTYzNmE5Y2IxNmIwODExOGNjMDVlZmEzZDA3YzM3NDA5MjRhYmIwODAzPgovVSA8MjQ0MDM1YWEyZTdlZGEwODRlOGI5NzcwYzFjNTE3YTVjZGY5ZWNmNTliZWIwYjM2NmU5NTJmMDA1NmNkN2IzYz4KPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMTQ5IDAwMDAwIG4gCjAwMDAwMDAyMDggMDAwMDAgbiAKMDAwMDAwMDI1NyAwMDAwMCBuIAowMDAwMDAwMzUxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgovSUQgWyA8MzgzMDM1NjQzMTM2NjU2NTM2MzU2NjYxNjI2NjM1MzUzNzM0MzgzNzMyMzMzNDYxMzIzNTM4MzI2NDY0MzEzNT4gPDM4MzAzNTY0MzEzNjY1NjUzNjM1NjY2MTYyNjYzNTM1MzczNDM4MzczMjMzMzQ2MTMyMzUzODMyNjQ2NDMxMzU+IF0KL0VuY3J5cHQgNSAwIFIKPj4Kc3RhcnR4cmVmCjU2NQolJUVPRgo=', 'base64');
}

function fixture(id: string, name: string, source: Source, first: Color = 'red', bytes = twoPagePdf(first)): Fixture {
  const storageObject = `projects/${projectId}/tasks/${taskId}/comment_attachments/${id}.pdf`;
  return { id, name, source, bytes, type: name.endsWith('.PDF') ? 'application/octet-stream' : 'application/pdf',
    size: bytes.length, url: `https://firebasestorage.googleapis.com/v0/b/demo-pdf-project.appspot.com/o/${encodeURIComponent(storageObject)}?alt=media&token=fictitious-thumbnail-token` };
}
const commentSource = (attachmentId: string): Source => ({ projectId, kind: 'comment', taskId, commentId, attachmentId });
const attachment = (file: Fixture) => ({ id: file.id, name: file.name, type: file.type, size: file.size, url: file.url });
async function probe(page: Page) { return page.evaluate(() => (window as unknown as ProbeWindow).thumbnailProbe); }

async function prepare(page: Page, files: Fixture[], options: { reference?: boolean; status?: number } = {}) {
  const details: Diagnostics = { unexpected: [], sources: [], assets: [], consoleErrors: [] };
  diagnostics.set(page, details);
  page.on('console', message => { if (message.type() === 'error') details.consoleErrors.push(message.text()); });
  const fixtures = new Map(files.map(file => [file.id, file]));
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:3020' && url.pathname === sourcePath) {
      expect(request.method()).toBe('POST');
      expect(request.headers().authorization).toBeUndefined();
      const source = request.postDataJSON() as Source;
      const file = fixtures.get(source.attachmentId);
      if (!file) { details.unexpected.push(`Unknown thumbnail: ${JSON.stringify(source)}`); await route.abort(); return; }
      expect(source).toEqual(file.source);
      details.sources.push(source);
      if (options.status) await route.fulfill({ status: options.status, contentType: 'application/json', body: '{"error":"Fictitious access denied"}' });
      else await route.fulfill({ status: 200, contentType: 'application/pdf', body: file.bytes });
      return;
    }
    const pdf = files.find(file => file.url === request.url());
    if (pdf) { await route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' }, body: pdf.bytes }); return; }
    if (url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
      || url.protocol === 'chrome:' && url.hostname === 'resources') { await route.continue(); return; }
    if (url.origin !== 'http://127.0.0.1:3020' || url.pathname.startsWith('/api/')) {
      details.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    if (url.pathname.startsWith(assetBase)) details.assets.push(url.pathname);
    await route.continue();
  });
  const seedFiles = options.reference ? [] : [attachment(files[0])];
  const referenceFiles = options.reference ? [attachment(files[0])] : [];
  const referenceCommentFiles = options.reference ? [attachment(files[1])] : [];
  await page.addInitScript(({ storageKey, projectId, taskId, commentId, referenceId, referenceCommentId, seedFiles, referenceFiles, referenceCommentFiles }) => {
    if (window !== window.top) return;
    const state: ThumbnailProbe = { workers: [], terminated: [], workerErrors: [], violations: [] };
    (window as unknown as ProbeWindow).thumbnailProbe = state;
    document.addEventListener('securitypolicyviolation', event => state.violations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      readonly fixtureUrl: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.fixtureUrl = String(url); state.workers.push(this.fixtureUrl);
        this.addEventListener('error', event => state.workerErrors.push(event.message));
      }
      terminate() { state.terminated.push(this.fixtureUrl); super.terminate(); }
    };
    const now = '2026-10-15T00:00:00.000Z';
    localStorage.setItem(storageKey, JSON.stringify({ data: {
      tasks: { [taskId]: { projectId, listId: 'doing', title: 'PDF thumbnail isolated test', description: '', order: 1,
        assigneeIds: ['e2e-mock-user'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
        startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false, isCompleted: false,
        completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null,
        createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now } },
      children: { [`tasks/${taskId}/comments/${commentId}`]: { taskId, authorId: 'e2e-mock-user', authorLabel: '本人',
        content: '架空の PDF サムネイルを確認します。', mentions: [], createdAt: now, updatedAt: now, attachments: seedFiles } },
      references: { [referenceId]: { id: referenceId, projectId, listId: 'doing', title: 'PDF thumbnail reference', body: '', comment: '', links: [],
        attachments: referenceFiles, order: 1, createdBy: 'e2e-mock-user', updatedBy: 'e2e-mock-user', createdAt: now, updatedAt: now, isArchived: false } },
      listIds: ['doing'], memberIds: ['e2e-mock-user', 'demo-colleague'],
    }, referenceComments: { [referenceId]: [{ id: referenceCommentId, referenceId, authorId: 'e2e-mock-user', authorLabel: '本人',
      content: '架空の関連情報コメントです。', attachments: referenceCommentFiles, createdAt: now, updatedAt: now }] }, entries: [], activityLogs: [] }));
  }, { storageKey, projectId, taskId, commentId, referenceId, referenceCommentId, seedFiles, referenceFiles, referenceCommentFiles });
  await page.goto(`/projects/${projectId}/board${options.reference ? '' : `?task=${taskId}`}`);
  await expect(page.getByText('隔離環境の共有作業台', { exact: true })).toBeVisible();
  if (!options.reference) await expect(page.getByRole('textbox', { name: 'タスク名', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important; }' });
  return details;
}

async function assertFirstPage(image: Locator, color: Color) {
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  const bitmap = await image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0);
    return { width: canvas.width, height: canvas.height, pixel: [...context.getImageData(Math.floor(canvas.width * 0.75), Math.floor(canvas.height * 0.75), 1, 1).data] };
  });
  expect(bitmap.width).toBeGreaterThan(0); expect(bitmap.height).toBeGreaterThan(0);
  expect(Math.max(bitmap.width, bitmap.height)).toBeLessThanOrEqual(512);
  expect(bitmap.pixel[color === 'red' ? 0 : 2]).toBeGreaterThan(220);
  expect(bitmap.pixel[color === 'red' ? 2 : 0]).toBeLessThan(35);
  expect(bitmap.pixel[1]).toBeLessThan(35);
  expect(bitmap.pixel[3]).toBe(255);
}

async function nativePreview(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await expect.poll(async () => {
    const viewer = page.frames().find(frame => frame.url().startsWith('chrome-extension://') && frame.url().endsWith('/index.html'));
    if (!viewer) return null;
    try { return await viewer.locator('#pagelength').textContent({ timeout: 500 }); } catch { return null; }
  }, { timeout: 15000 }).toBe('2');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  return dialog;
}

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  await testInfo.attach('pdf-thumbnail-diagnostics.json', { body: JSON.stringify({ ...diagnostics.get(page), probe: await probe(page) }, null, 2), contentType: 'application/json' });
});

for (const width of [1440, 390]) test(`task/comment first-page bitmap, newly seeded file, and native preview (${width}px)`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const existing = fixture('existing-pdf', 'existing-two-page.pdf', commentSource('existing-pdf'));
  const added = fixture('new-pdf', 'newly-added.PDF', commentSource('new-pdf'), 'blue');
  const details = await prepare(page, [existing, added]);
  const unchanged = await page.evaluate(key => localStorage.getItem(key), storageKey);
  const card = page.getByRole('region', { name: '添付ファイル', exact: true }).getByRole('link', { name: new RegExp(existing.name) });
  await assertFirstPage(card.getByRole('img', { name: `${existing.name}の1ページ目`, exact: true }), 'red');
  await page.screenshot({ path: testInfo.outputPath(`task-thumbnail-${width}.png`) });
  const dialog = await nativePreview(page, card, existing.name);
  await page.screenshot({ path: testInfo.outputPath(`thumbnail-native-preview-${width}.png`) });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const comment = page.locator(`#task-comment-${commentId}`);
  await assertFirstPage(comment.getByRole('img', { name: `${existing.name}の1ページ目`, exact: true }), 'red');
  await page.screenshot({ path: testInfo.outputPath(`comment-thumbnail-${width}.png`) });
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(unchanged);
  // Simulate newly observed saved metadata only in this isolated browser; no upload/save is performed.
  await page.evaluate(({ key, taskId, commentId, file }) => {
    const work = JSON.parse(localStorage.getItem(key)!);
    work.data.children[`tasks/${taskId}/comments/${commentId}`].attachments.push(file);
    localStorage.setItem(key, JSON.stringify(work)); window.dispatchEvent(new Event('taskflow-work-updated'));
  }, { key: storageKey, taskId, commentId, file: attachment(added) });
  const newCard = page.getByRole('region', { name: '添付ファイル', exact: true }).getByRole('link', { name: new RegExp(added.name) });
  await assertFirstPage(newCard.getByRole('img', { name: `${added.name}の1ページ目`, exact: true }), 'blue');
  await assertFirstPage(card.getByRole('img', { name: `${existing.name}の1ページ目`, exact: true }), 'red');
  await page.screenshot({ path: testInfo.outputPath(`newly-seeded-thumbnails-${width}.png`) });
  expect(details.sources.filter(source => source.attachmentId === existing.id)).toHaveLength(1);
  expect(details.sources.filter(source => source.attachmentId === added.id)).toHaveLength(1);
  expect(details.assets).toContain(`${assetBase}pdf.worker.min.mjs`);
  expect(details.unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
  expect((await probe(page)).workerErrors).toEqual([]);
});

test('reference and reference-comment show the correct first-page bitmap and keep native preview', async ({ page }, testInfo) => {
  const reference = fixture('reference-pdf', 'reference-two-page.pdf', { projectId, kind: 'reference', referenceId, attachmentId: 'reference-pdf' });
  const comment = fixture('reference-comment-pdf', 'reference-comment.pdf', { projectId, kind: 'reference-comment', referenceId, commentId: referenceCommentId, attachmentId: 'reference-comment-pdf' }, 'blue');
  const details = await prepare(page, [reference, comment], { reference: true });
  const unchanged = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await page.getByRole('region', { name: 'このリストの関連情報', exact: true }).getByRole('button', { name: 'PDF thumbnail reference', exact: true }).click();
  const panel = page.getByRole('dialog'); await expect(panel).toBeVisible();
  await assertFirstPage(panel.getByRole('img', { name: `${reference.name}の1ページ目`, exact: true }), 'red');
  await assertFirstPage(panel.getByRole('img', { name: `${comment.name}の1ページ目`, exact: true }), 'blue');
  await page.screenshot({ path: testInfo.outputPath('reference-thumbnails.png') });
  const preview = await nativePreview(page, panel.getByRole('link', { name: new RegExp(reference.name) }), reference.name);
  await preview.getByRole('button', { name: 'Close', exact: true }).click(); await expect(preview).toHaveCount(0);
  expect(details.sources).toEqual(expect.arrayContaining([reference.source, comment.source]));
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(unchanged);
  expect(details.unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
});

for (const failure of ['corrupt', 'encrypted', 'forbidden'] as const) test(`${failure} thumbnail keeps the PDF icon without a red error`, async ({ page }, testInfo) => {
  const bytes = failure === 'corrupt' ? Buffer.from('%PDF-1.7\ninvalid synthetic PDF\n%%EOF\n') : failure === 'encrypted' ? passwordProtectedPdf() : twoPagePdf();
  const file = fixture(`${failure}-pdf`, `${failure}.pdf`, commentSource(`${failure}-pdf`), 'red', bytes);
  const details = await prepare(page, [file], { status: failure === 'forbidden' ? 403 : undefined });
  const unchanged = await page.evaluate(key => localStorage.getItem(key), storageKey);
  const card = page.getByRole('region', { name: '添付ファイル', exact: true }).getByRole('link', { name: new RegExp(file.name) });
  await expect.poll(() => details.sources.length).toBeGreaterThan(0);
  if (failure !== 'forbidden') await expect.poll(async () => (await probe(page)).terminated.length, { timeout: 20000 }).toBeGreaterThan(0);
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(card.locator('svg.lucide-file-text')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(card).toHaveAttribute('href', file.url);
  await page.screenshot({ path: testInfo.outputPath(`thumbnail-${failure}-fallback.png`) });
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(unchanged);
  expect(details.unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
});
