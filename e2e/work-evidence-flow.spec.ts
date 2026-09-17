import { test, expect, type Page } from '@playwright/test';
const key = 'taskflow-organization-lab-v1:secretary-demo';
async function taskState(page: Page, id: string) {
  return page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)!).data.tasks[id], { key, id });
}
async function openTask(page: Page, id: string) {
  await page.goto(`/projects/secretary-demo/board?task=${id}`);
  await expect(page.getByRole('textbox', { name: 'タスク名', exact: true })).toBeVisible();
}
async function openAutomation(page: Page) {
  await page.getByRole('button', { name: /^自動確認：/ }).click();
  await expect(page.getByRole('region', { name: '根拠からの自動更新' })).toBeVisible();
}
async function grant(page: Page, person: string) {
  await openAutomation(page);
  const panel = page.getByRole('region', { name: '根拠からの自動更新' });
  await panel.getByRole('button', { name: 'このタスクの確認を任せる', exact: true }).click();
  await panel.getByLabel('商品・イベント名', { exact: true }).fill('秋の展示会');
  await panel.getByLabel('対象の年・期間・注文番号', { exact: true }).fill('2026');
  await panel.getByLabel('根拠に記載される対象者の名前', { exact: true }).fill(person);
  await panel.getByLabel('購入先の送信元メールアドレス', { exact: true }).fill('shop@example.test');
  await panel.getByRole('button', { name: 'この条件で自動更新を許可', exact: true }).click();
  await expect(panel.getByRole('button', { name: '確認を更新', exact: true })).toBeVisible();
  await panel.getByText('隔離テスト：架空の根拠を追加', { exact: true }).click();
}
async function evidence(page: Page, text: string) {
  const panel = page.getByRole('region', { name: '根拠からの自動更新' });
  await panel.getByLabel('架空の根拠', { exact: true }).fill(text);
  await panel.getByRole('button', { name: '架空のメールを照合', exact: true }).click();
  await expect(panel.getByRole('button', { name: '架空のメールを照合', exact: true })).toBeEnabled();
}
for (const width of [1440, 390]) test(`meeting → shared tasks → individual evidence → all-person condition → reminder → Neo (${width}px)`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
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
  const organizer = page.getByRole('dialog', { name: '仕事の整理と反映', exact: true });
  await organizer.getByLabel('資料の名前', { exact: true }).fill('展示会の準備会議');
  await organizer.getByLabel('文字起こし・メモ', { exact: true }).fill('2026年秋の展示会。案内文に購入先を追記する。本人と同僚のチケットはそれぞれ購入と支払が必要。');
  await organizer.getByRole('button', { name: 'AIで既存の仕事と照合', exact: true }).click();
  await organizer.getByRole('button', { name: '変更後の姿を確認', exact: true }).click();
  await organizer.getByRole('button', { name: '採用して反映', exact: true }).click();
  await expect(organizer.getByRole('region', { name: '反映する変更' })).toContainText('反映済み');
  await organizer.getByRole('region', { name: '反映する変更' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`organization-adopted-${width}.png`) });
  await page.keyboard.press('Escape');
  await openTask(page, 'draft');
  await expect(page.getByRole('region', { name: 'いまの状況と次の担当' })).toContainText('本人');
  await page.getByText('経緯・変更履歴を見る', { exact: true }).click();
  const history = page.getByRole('region', { name: 'このタスクの経緯' });
  await expect(history).toContainText('展示会の準備会議');
  await history.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`task-history-${width}.png`), fullPage: true });
  // Isolated fixture date only; application operations below perform all actual transitions.
  await page.evaluate(key => { const work = JSON.parse(localStorage.getItem(key)!); work.data.tasks['purchase-parent'].dueDate = new Date(Date.now() + 86400000).toISOString(); localStorage.setItem(key, JSON.stringify(work)); }, key);
  await openTask(page, 'purchase-parent');
  await openAutomation(page);
  let panel = page.getByRole('region', { name: '根拠からの自動更新' });
  await panel.getByText('全員分がそろったら親も完了する', { exact: true }).click();
  await panel.getByLabel('全員分の明示的な完了条件').fill('必要な本人・同僚が各自の購入と支払を完了した');
  await panel.getByLabel('本人の2026年秋の展示会チケット購入', { exact: true }).check();
  await panel.getByLabel('同僚の2026年秋の展示会チケット購入', { exact: true }).check();
  await panel.getByRole('button', { name: 'この全員条件の自動判定を許可', exact: true }).click();
  await expect(panel).toContainText('完了をまだ確認できません');
  await panel.getByRole('button', { name: '1時間後', exact: true }).click();
  await expect(panel).toContainText('次の確認：');
  await openTask(page, 'purchase-self'); await grant(page, '本人');
  await evidence(page, '秋の展示会 2026 本人 申込受付');
  expect((await taskState(page, 'purchase-self')).isCompleted).toBe(false);
  await evidence(page, '秋の展示会 2026 本人 購入済みですか？');
  expect((await taskState(page, 'purchase-self')).isCompleted).toBe(false);
  await evidence(page, '秋の展示会 2026 本人 購入完了');
  expect((await taskState(page, 'purchase-self')).isCompleted).toBe(true);
  expect((await taskState(page, 'purchase-parent')).isCompleted).toBe(false);
  await openTask(page, 'purchase-peer'); await grant(page, '同僚');
  await evidence(page, '秋の展示会 2025 同僚 購入完了');
  expect((await taskState(page, 'purchase-peer')).isCompleted).toBe(false);
  await evidence(page, '秋の展示会 2026 同僚 代理購入 購入完了');
  expect((await taskState(page, 'purchase-parent')).isCompleted).toBe(true);
  await evidence(page, '秋の展示会 2026 同僚 返金完了');
  expect((await taskState(page, 'purchase-parent')).isCompleted).toBe(false);
  await openTask(page, 'purchase-parent');
  await openAutomation(page);
  panel = page.getByRole('region', { name: '根拠からの自動更新' });
  await expect(panel).toContainText('本人：完了確認済み');
  await expect(panel).toContainText('同僚：完了をまだ確認できません');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`task-evidence-${width}.png`), fullPage: true });
  await panel.getByRole('button', { name: '再通知', exact: true }).click();
  await expect(panel.getByRole('button', { name: '再通知', exact: true })).toBeEnabled();
  await page.goto('/neo');
  await expect(page.getByRole('heading', { name: '朝のブリーフ', exact: true })).toBeVisible();
  await expect(page.getByTestId('neo-morning-brief')).toContainText('全員分の確認状況');
  await expect(page.getByTestId('neo-morning-brief').getByRole('link', { name: /2026年秋の展示会チケットを全員分そろえる/ })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath(`neo-brief-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '一覧表示', exact: true }).click();
  await expect(page.getByRole('link', { name: /2026年秋の展示会チケットを全員分そろえる/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`neo-evidence-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});

test('adopt a merge, read archived original evidence, then undo without losing comments (390px)', async ({ page }, testInfo) => {
  const unexpected: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (['fetch', 'xhr'].includes(request.resourceType()) && (url.pathname.startsWith('/api/') || !['localhost', '127.0.0.1'].includes(url.hostname))) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/my-dashboard');
  await expect(page.getByText('隔離環境：保存・反映先はこのブラウザの架空データです。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文字起こし・メモを取り込む', exact: true }).click();
  await expect.poll(() => page.evaluate(key => !!localStorage.getItem(key), key)).toBe(true);
  await page.keyboard.press('Escape');
  // One duplicate with existing evidence, prepared solely inside this fresh isolated browser context.
  await page.evaluate(key => {
    const work = JSON.parse(localStorage.getItem(key)!); const now = new Date().toISOString();
    work.data.tasks.duplicate = { ...work.data.tasks.draft, title: '同じ案内文の重複メモ', description: '同じ2026年9月の公開用案内文。申込先の最終確認を含む。' };
    work.data.children['tasks/duplicate/comments/original-comment'] = { authorId: 'e2e-mock-user', authorLabel: '本人', content: '購入先のリンクは確認済みです。', mentions: [], createdAt: now, updatedAt: now };
    work.data.children['tasks/duplicate/checklists/original-list'] = { title: '公開前の確認', order: 0, items: [{ id: 'link', text: '申込リンクを確認', isChecked: true, order: 0 }], createdAt: now };
    localStorage.setItem(key, JSON.stringify(work));
  }, key);
  await page.reload();
  await page.getByRole('button', { name: '文字起こし・メモを取り込む', exact: true }).click();
  let organizer = page.getByRole('dialog', { name: '仕事の整理と反映', exact: true });
  await organizer.getByLabel('文字起こし・メモ', { exact: true }).fill('同じ案内文、同じ公開期間・担当・完了条件の重複を一つに集約する。');
  await organizer.getByRole('button', { name: '自分で整理案を指定', exact: true }).click();
  await organizer.getByRole('combobox', { name: '扱い', exact: true }).selectOption('merge');
  await organizer.getByRole('combobox', { name: '統合して残す仕事', exact: true }).selectOption('draft');
  await organizer.getByLabel('同じ案内文の重複メモ', { exact: true }).check();
  await organizer.getByRole('button', { name: '変更後の姿を確認', exact: true }).click();
  await organizer.getByRole('button', { name: '採用して反映', exact: true }).click();
  await expect(organizer.getByRole('region', { name: '反映する変更' })).toContainText('反映済み');
  expect((await taskState(page, 'duplicate')).isArchived).toBe(true);
  await page.goto('/projects/secretary-demo/board?task=draft');
  const relations = page.getByRole('region', { name: '親タスクと確認依頼' });
  await expect(relations).toContainText('統合元の記録（1件）');
  await relations.getByRole('button').click();
  const original = page.getByRole('dialog', { name: '同じ案内文の重複メモ', exact: true });
  await expect(original).toContainText('購入先のリンクは確認済みです。');
  await original.getByText('コメントの全文を開く', { exact: true }).click();
  await expect(original.locator('details[open]')).toContainText('購入先のリンクは確認済みです。');
  await expect(original).toContainText('✓ 申込リンクを確認');
  await page.screenshot({ path: testInfo.outputPath('merged-original-390.png'), animations: 'disabled' });
  await page.goto('/my-dashboard');
  await page.getByRole('button', { name: '文字起こし・メモを取り込む', exact: true }).click();
  organizer = page.getByRole('dialog', { name: '仕事の整理と反映', exact: true });
  await organizer.getByText('採用・保留の記録（1件）', { exact: true }).click();
  await organizer.getByRole('button', { name: /反映済み · 案内文を仕上げる/ }).click();
  await organizer.getByRole('button', { name: '反映を戻す', exact: true }).click();
  await expect(organizer.getByRole('region', { name: '反映する変更' })).toContainText('取消済み');
  expect((await taskState(page, 'duplicate')).isArchived).toBe(false);
  const comments = await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)!).data.children).filter(path => path.includes('/comments/')), key);
  expect(comments).toEqual(['tasks/duplicate/comments/original-comment']);
  expect(unexpected).toEqual([]);
});
