import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) test(`companion notices keep conversations and open the original task (${width}px)`, async ({ page }, testInfo) => {
  const unexpected: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (['fetch', 'xhr'].includes(request.resourceType()) && (url.pathname.startsWith('/api/') || !['localhost', '127.0.0.1'].includes(url.hostname))) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    await route.continue();
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/my-dashboard');
  await expect(page.getByText('隔離環境：保存・反映先はこのブラウザの架空データです。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文字起こし・メモを取り込む', exact: true }).click();
  const key = 'taskflow-organization-lab-v1:secretary-demo';
  await expect.poll(() => page.evaluate(key => !!localStorage.getItem(key), key)).toBe(true);
  // Prepare a reminder entirely in this isolated browser's existing fixture store.
  const saved = await page.evaluate(key => {
    const work = JSON.parse(localStorage.getItem(key)!); const uid = 'e2e-mock-user'; const now = new Date().toISOString();
    work.data.tasks['purchase-parent'].dueDate = now;
    work.data.tasks['purchase-parent'].completionPolicy = { kind: 'all_required_children', condition: '必要な全員が購入した', grantedBy: uid, grantedAt: now, required: [{ taskId: 'purchase-self', assigneeId: uid }, { taskId: 'purchase-peer', assigneeId: 'demo-colleague' }] };
    work.automationStates = { [uid]: { uid, revision: 1, automationEnabled: true, grants: [], reminders: [{ projectId: 'secretary-demo', taskId: 'purchase-parent', dueDate: now, notifiedSignature: 'pending', snoozedUntil: null, sequence: 0 }] } };
    const saved = JSON.stringify(work); localStorage.setItem(key, saved); return saved;
  }, key);
  await page.goto('/neo');
  if (width === 390 && await page.locator('aside').isVisible()) await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: '未読の通知1件を開く', exact: true }).first().click();
  const panel = page.getByTestId('companion-ai-panel');
  const notices = panel.getByRole('region', { name: '相棒の通知', exact: true });
  await expect(notices.getByText('全員分の完了をまだ確認できません', { exact: true })).toBeVisible();
  await expect(notices.getByRole('link')).toHaveAttribute('href', '/projects/secretary-demo/board?task=purchase-parent');
  await expect(panel.getByRole('button', { name: /^通知/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(saved);
  await panel.getByRole('button', { name: '会話', exact: true }).click();
  await expect(notices).toHaveCount(0);
  await panel.getByRole('button', { name: /^通知/ }).click();
  await expect(notices).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(saved);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await notices.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`companion-notices-${width}.png`), fullPage: true });
  await notices.getByRole('link').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'タスク名', exact: true })).toHaveValue('2026年秋の展示会チケットを全員分そろえる');
  expect(unexpected).toEqual([]);
});
