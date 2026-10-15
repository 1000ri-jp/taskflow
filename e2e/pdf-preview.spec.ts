import { test, expect, type Page, type Route } from '@playwright/test';

const projectId = 'secretary-demo';
const taskId = 'pdf-preview-task';
const storageKey = `taskflow-organization-lab-v1:${projectId}`;
const fileName = 'isolated-preview.pdf';
const pdfUrl = 'https://firebasestorage.googleapis.com/v0/b/demo-pdf-project.appspot.com/o/projects%2Fsecretary-demo%2Ftasks%2Fpdf-preview-task%2Fcomment_attachments%2Ffixture.pdf?alt=media&token=fictitious-test-token';

type PreviewProbe = { created: string[]; revoked: string[]; aborted: number; violations: string[] };
type ProbeWindow = Window & { pdfPreviewProbe: PreviewProbe };
const diagnostics = new WeakMap<Page, { unexpected: string[]; consoleErrors: string[] }>();

// An original, one-page fixture containing only public test text. Xref offsets are computed in bytes.
function fixturePdf(): Buffer {
  const stream = 'BT /F1 28 Tf 72 690 Td (TASKFLOW PDF PREVIEW) Tj 0 -50 Td /F1 16 Tf (Isolated browser fixture - no private data.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function prepare(page: Page, servePdf: (route: Route) => Promise<void>) {
  const unexpected: string[] = [];
  const consoleErrors: string[] = [];
  diagnostics.set(page, { unexpected, consoleErrors });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url() === pdfUrl) { await servePdf(route); return; }
    // Native preview coverage remains independent of optional thumbnail generation.
    if (url.origin === 'http://127.0.0.1:3020' && url.pathname === '/api/pdf-thumbnail/source' && request.method() === 'POST') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"No thumbnail in native preview tests"}' }); return;
    }
    // Native PDF viewer resources are browser-internal and make no network requests.
    if (url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
      || url.protocol === 'chrome:' && url.hostname === 'resources') { await route.continue(); return; }
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort(); return;
    }
    await route.continue();
  });
  await page.addInitScript(({ storageKey, projectId, taskId, fileName, pdfUrl, size }) => {
    // Browser-internal PDF frames must keep their own native globals and storage.
    if (window !== window.top) return;
    const probe: PreviewProbe = { created: [], revoked: [], aborted: 0, violations: [] };
    (window as unknown as ProbeWindow).pdfPreviewProbe = probe;
    document.addEventListener('securitypolicyviolation', event => {
      probe.violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
    });
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const result = createObjectURL(blob); probe.created.push(result); return result; };
    URL.revokeObjectURL = url => { probe.revoked.push(url); revokeObjectURL(url); };
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input === pdfUrl) init?.signal?.addEventListener('abort', () => { probe.aborted += 1; });
      return fetch(input, init);
    };
    const now = '2026-10-13T00:00:00.000Z';
    // Upload is deliberately unsupported by detailMock. Seed only this fresh browser context.
    localStorage.setItem(storageKey, JSON.stringify({
      data: {
        tasks: { [taskId]: { projectId, listId: 'doing', title: 'PDF preview isolated test', description: '', order: 1,
          assigneeIds: ['e2e-mock-user'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
          startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false, isCompleted: false,
          completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null,
          createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now } },
        children: { [`tasks/${taskId}/comments/pdf-fixture-comment`]: { taskId, authorId: 'e2e-mock-user',
          authorLabel: '本人', content: '機密情報のない PDF 表示テストです。', mentions: [], createdAt: now, updatedAt: now,
          attachments: [{ id: 'pdf-fixture', name: fileName, url: pdfUrl, type: 'application/pdf', size }] } },
        listIds: ['doing'], memberIds: ['e2e-mock-user', 'demo-colleague'],
      },
      entries: [], activityLogs: [],
    }));
  }, { storageKey, projectId, taskId, fileName, pdfUrl, size: fixturePdf().length });
  const response = await page.goto(`/projects/${projectId}/board?task=${taskId}`);
  expect(response?.headers()['content-security-policy']).toContain('https://firebasestorage.googleapis.com');
  await expect(page.getByText('隔離環境の共有作業台', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'タスク名', exact: true })).toBeVisible();
  // Devtools can overlay the attachment modal on narrow viewports.
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important; }' });
  return unexpected;
}

async function validPdf(route: Route, downloadOnly = false) {
  await route.fulfill({ status: 200, body: fixturePdf(), headers: {
    'access-control-allow-origin': '*',
    'content-type': downloadOnly ? 'application/octet-stream' : 'application/pdf',
    ...(downloadOnly ? { 'content-disposition': 'attachment; filename="isolated-preview.pdf"' } : {}),
  } });
}

async function openPreview(page: Page, compact = false) {
  const trigger = compact
    ? page.locator('#task-comment-pdf-fixture-comment').getByRole('link', { name: fileName, exact: true })
    : page.getByRole('region', { name: '添付ファイル', exact: true }).getByRole('link', { name: new RegExp(fileName) });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: fileName, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: '新しいタブで開く', exact: true })).toHaveAttribute('href', pdfUrl);
  return dialog;
}

async function closePreview(page: Page) {
  const dialog = page.getByRole('dialog', { name: fileName, exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function nativePdfReady(page: Page) {
  // Chromium's real PDF plugin proves the fixture reached the native viewer rather than an empty iframe.
  try { await expect.poll(async () => {
    const counts = await Promise.all(page.frames().map(async frame => {
      try { return await frame.locator('embed[type="application/x-google-chrome-pdf"]').count(); } catch { return 0; }
    }));
    return counts.reduce((sum, count) => sum + count, 0);
  }, { timeout: 15000 }).toBeGreaterThan(0); } catch (error) {
    console.log('PDF viewer frames:', await Promise.all(page.frames().map(async frame => {
      let content = '';
      try { content = (await frame.content()).slice(-1500); } catch { /* Closed frame. */ }
      return { url: frame.url(), content };
    })));
    throw error;
  }
  const viewer = page.frames().find(frame => frame.url().startsWith('chrome-extension://') && frame.url().endsWith('/index.html'));
  expect(viewer).toBeTruthy();
  // Page count is populated only after the native plugin parses the fixture.
  // Its toolbar can hide on narrow viewports, so check its text rather than visibility.
  await expect(viewer!.locator('#pagelength')).toHaveText('1');
}

async function probe(page: Page) { return page.evaluate(() => (window as unknown as ProbeWindow).pdfPreviewProbe); }

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const state = await probe(page);
  const details = { ...diagnostics.get(page), probe: state, frames: page.frames().map(frame => frame.url()) };
  await testInfo.attach('pdf-browser-diagnostics.json', { body: JSON.stringify(details, null, 2), contentType: 'application/json' });
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: testInfo.outputPath('pdf-debug.png') });
    // Unmount the native viewer before teardown so failed assertions also release pending resources.
    const dialog = page.getByRole('dialog', { name: fileName, exact: true });
    if (await dialog.count()) await page.keyboard.press('Escape');
  }
});

for (const { width, height } of [{ width: 1440, height: 1000 }, { width: 390, height: 600 }, { width: 844, height: 320 }]) test(`task and comment PDFs render, release resources and reopen (${width}x${height})`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height });
  let requested = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const unexpected = await prepare(page, async route => { requested += 1; await gate; await validPdf(route, true); });
  let dialog = await openPreview(page);
  await expect(dialog.getByRole('status')).toHaveText('PDFを読み込んでいます…');
  expect(await dialog.locator('iframe').count()).toBe(0);
  release();
  await nativePdfReady(page);
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const retryBox = await dialog.getByRole('button', { name: '再取得', exact: true }).boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(retryBox && dialogBox && retryBox.y + retryBox.height <= dialogBox.y + dialogBox.height).toBe(true);
  expect(retryBox && retryBox.y + retryBox.height <= height).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`task-pdf-rendered-${width}x${height}.png`) });
  const firstUrl = (await probe(page)).created.at(-1)!;
  await closePreview(page);
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await probe(page)).revoked).toContain(firstUrl);
  dialog = await openPreview(page, true);
  await nativePdfReady(page);
  await page.screenshot({ path: testInfo.outputPath(`comment-pdf-rendered-${width}x${height}.png`) });
  const beforeRetry = await dialog.locator('iframe').getAttribute('src');
  await dialog.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(dialog.locator('iframe')).not.toHaveAttribute('src', beforeRetry!);
  await nativePdfReady(page);
  expect((await probe(page)).created.at(-1)).not.toBe(firstUrl);
  await closePreview(page);
  dialog = await openPreview(page);
  await nativePdfReady(page);
  await closePreview(page);
  const state = await probe(page);
  await expect.poll(async () => { const latest = await probe(page); return latest.revoked.length === latest.created.length; }).toBe(true);
  expect((await probe(page)).revoked).toEqual(state.created);
  expect(state.violations).toEqual([]);
  expect(requested).toBe(4);
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const status of [403, 404, 500]) test(`HTTP ${status} is actionable and retry renders the PDF`, async ({ page }, testInfo) => {
  let attempts = 0;
  const unexpected = await prepare(page, async route => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"fictitious failure"}' });
    else await validPdf(route);
  });
  const dialog = await openPreview(page, status === 404);
  await expect(dialog.getByRole('alert')).toContainText('PDFを読み込めませんでした。');
  await expect(dialog.locator('iframe')).toHaveCount(0);
  if (status === 403) await page.screenshot({ path: testInfo.outputPath('pdf-http-error.png') });
  await dialog.getByRole('button', { name: '再取得', exact: true }).click();
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(attempts).toBe(2);
  await closePreview(page);
  expect(unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
});

test('network fetch failure renders a direct PDF without an error, reopens, and retries', async ({ page }, testInfo) => {
  let fetchAttempts = 0;
  let fallbackRequests = 0;
  let recoverFetch = false;
  const unexpected = await prepare(page, async route => {
    if (route.request().resourceType() === 'fetch') {
      fetchAttempts += 1;
      if (!recoverFetch) { await route.abort('failed'); return; }
    } else fallbackRequests += 1;
    await validPdf(route);
  });
  let dialog = await openPreview(page, true);
  await expect(dialog.locator('iframe')).toHaveAttribute('src', pdfUrl);
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByText(/PDFの読み込みを確認できませんでした/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('pdf-network-fallback.png') });
  expect(fetchAttempts).toBe(1);
  expect(fallbackRequests).toBe(1);
  await closePreview(page);
  dialog = await openPreview(page);
  await expect(dialog.locator('iframe')).toHaveAttribute('src', pdfUrl);
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByText(/PDFの読み込みを確認できませんでした/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('pdf-network-fallback-reopened.png') });
  expect(fetchAttempts).toBe(2);
  expect(fallbackRequests).toBe(2);
  const directFrames = page.frames().filter(frame => frame.url() === pdfUrl || frame.url().startsWith('chrome-extension://'));
  recoverFetch = true;
  await dialog.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => directFrames.every(frame => frame.isDetached())).toBe(true);
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(fetchAttempts).toBe(3);
  expect(fallbackRequests).toBe(2);
  await closePreview(page);
  const state = await probe(page);
  expect(state.created).toHaveLength(1);
  expect(state.revoked).toEqual(state.created);
  expect(unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
});

test('PDF without CORS permission renders natively without a false error', async ({ page }, testInfo) => {
  let fetchAttempts = 0;
  let directRequests = 0;
  const unexpected = await prepare(page, async route => {
    if (route.request().resourceType() === 'fetch') fetchAttempts += 1;
    else directRequests += 1;
    // A valid PDF can be embeddable while its server disallows JavaScript fetch.
    // Playwright supplies ACAO when omitted; another allowed origin forces real CORS rejection.
    await route.fulfill({ status: 200, contentType: 'application/pdf',
      headers: { 'access-control-allow-origin': 'https://unrelated.example.test' }, body: fixturePdf() });
  });
  const dialog = await openPreview(page);
  await expect(dialog.locator('iframe')).toHaveAttribute('src', pdfUrl);
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByText(/PDFの読み込みを確認できませんでした/)).toHaveCount(0);
  await expect(dialog.getByText('表示されない場合は「新しいタブで開く」からPDFを確認できます。', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '再取得', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pdf-cors-native-preview.png') });
  expect(fetchAttempts).toBe(1);
  expect(directRequests).toBe(1);
  expect(diagnostics.get(page)?.consoleErrors.join('\n')).toMatch(/CORS/);
  await closePreview(page);
  expect(unexpected).toEqual([]);
  expect((await probe(page)).violations).toEqual([]);
});

test('closing a pending PDF cancels it, and reopening starts a fresh successful request', async ({ page }) => {
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const unexpected = await prepare(page, async route => {
    attempts += 1;
    if (attempts === 1) { await gate; await route.abort('aborted'); return; }
    await validPdf(route);
  });
  let dialog = await openPreview(page);
  await expect(dialog.getByRole('status')).toHaveText('PDFを読み込んでいます…');
  await expect.poll(() => attempts).toBe(1);
  await closePreview(page);
  await expect.poll(async () => (await probe(page)).aborted).toBe(1);
  release();
  dialog = await openPreview(page);
  await nativePdfReady(page);
  expect(attempts).toBe(2);
  await closePreview(page);
  expect(unexpected).toEqual([]);
});

test('slow PDF reports a timeout and retry succeeds', async ({ page }, testInfo) => {
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const unexpected = await prepare(page, async route => {
    attempts += 1;
    if (attempts === 1) { await gate; await route.abort('aborted'); return; }
    await validPdf(route);
  });
  const dialog = await openPreview(page);
  await expect(dialog.getByRole('status')).toHaveText('PDFを読み込んでいます…');
  await expect(dialog.getByRole('alert')).toContainText('PDFの読み込みに時間がかかっています。', { timeout: 35000 });
  await expect(dialog.locator('iframe')).toHaveCount(0);
  expect((await probe(page)).aborted).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('pdf-timeout.png') });
  release();
  await dialog.getByRole('button', { name: '再取得', exact: true }).click();
  await nativePdfReady(page);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(attempts).toBe(2);
  await closePreview(page);
  expect(unexpected).toEqual([]);
});
