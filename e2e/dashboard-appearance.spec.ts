import { test, expect, type Page } from '@playwright/test';

async function isolate(page: Page) {
  const unexpected: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (['fetch', 'xhr'].includes(request.resourceType()) && (url.pathname.startsWith('/api/') || !['localhost', '127.0.0.1'].includes(url.hostname))) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    await route.continue();
  });
  return unexpected;
}

async function chooseDashboard(page: Page, name: '旧版' | '新版' | 'Neo') {
  if (new URL(page.url()).pathname === '/neo') {
    await page.getByRole('banner').getByRole('button', { name: 'EM', exact: true }).click();
    await page.getByRole('menuitem', { name: '設定', exact: true }).click();
  } else {
    await page.getByRole('link', { name: '画面の設定', exact: true }).click();
  }
  await page.getByRole('radio', { name, exact: true }).check();
  await page.getByRole('link', { name: '選んだ画面を開く', exact: true }).click();
}

test('three dashboards retain the chosen entry, and classic can be restored independently', async ({ page }) => {
  const unexpected = await isolate(page);
  await page.goto('/');
  await expect(page.getByText('ローカル検証用・架空データ。', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'ダッシュボードを選ぶ' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/classic$/);
  await page.getByPlaceholder('メモを入力...').fill('画面を切り替えても残す架空のメモ');
  await chooseDashboard(page, '新版');
  await expect(page).toHaveURL(/\/my-dashboard$/);
  await expect(page.getByText('今日のブリーフ', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Neo AI秘書' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings#dashboard-view$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/classic$/);
  await expect(page.getByPlaceholder('メモを入力...')).toHaveValue('画面を切り替えても残す架空のメモ');
  await chooseDashboard(page, '新版');
  await chooseDashboard(page, '旧版');
  await expect(page.getByPlaceholder('メモを入力...')).toHaveValue('画面を切り替えても残す架空のメモ');
  await chooseDashboard(page, 'Neo');
  await expect(page.getByRole('heading', { name: '朝のブリーフ', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/neo$/);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'neo');
  await page.getByRole('button', { name: 'デザイン', exact: true }).click();
  await page.getByRole('radio', { name: /クラシック/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'classic');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'classic');
  expect(await page.evaluate(() => localStorage.getItem('taskflow.dashboardView.v1'))).toBe('neo');
  await chooseDashboard(page, '旧版');
  await expect(page).toHaveURL(/\/classic$/);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('taskflow.dashboardView.v1'))).toBe('classic');
  expect(unexpected).toEqual([]);
});

test('invalid saved choice falls back safely and an explicit old dashboard link overrides Neo', async ({ page }) => {
  const unexpected = await isolate(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('initialized-choice-test')) {
      localStorage.setItem('taskflow.dashboardView.v1', 'https://invalid.example');
      localStorage.setItem('taskflow.appearance.v1', 'unknown');
      localStorage.setItem('unrelated-draft', 'keep this');
      sessionStorage.setItem('initialized-choice-test', 'true');
    }
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/classic$/);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'neo');
  await chooseDashboard(page, 'Neo');
  await page.goto('/classic');
  expect(await page.evaluate(() => localStorage.getItem('taskflow.dashboardView.v1'))).toBe('classic');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-draft'))).toBe('keep this');
  expect(unexpected).toEqual([]);
});

test('appearance switches without losing an unsent scoped conversation or changing its target', async ({ page }) => {
  const unexpected = await isolate(page);
  await page.goto('/neo');
  const secretary = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(secretary.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await secretary.getByRole('button', { name: '整理', exact: true }).click();
  const proposal = secretary.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true });
  await proposal.getByText('根拠・訂正・共有への反映', { exact: true }).click();
  await proposal.getByRole('button', { name: '説明をAIで編集', exact: true }).click();
  const chat = page.getByTestId('companion-ai-panel');
  await chat.getByRole('textbox').fill('これはまだ送らない下書き');
  await page.getByRole('button', { name: 'AIアシスタントを閉じる', exact: true }).click();
  await expect(chat).toHaveCount(0);
  await page.getByRole('button', { name: 'AIに相談する', exact: true }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('これはまだ送らない下書き');
  for (const [appearance, label] of [['classic', /クラシック/], ['ivory', /^Ivory/], ['neo', /^Neo/]] as const) {
    await page.getByRole('button', { name: 'デザイン', exact: true }).click();
    await page.getByRole('radio', { name: label }).check();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    await page.keyboard.press('Escape');
    if (!await chat.isVisible()) await page.getByTestId('companion-ai-toggle').click();
    await expect(chat.getByRole('textbox')).toHaveValue('これはまだ送らない下書き');
    await expect(chat.getByRole('heading', { name: '案内文を仕上げるの説明', exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await chooseDashboard(page, '新版');
  await chooseDashboard(page, 'Neo');
  if (!await chat.isVisible()) await page.getByTestId('companion-ai-toggle').click();
  await expect(chat.getByRole('textbox')).toHaveValue('これはまだ送らない下書き');
  expect(unexpected).toEqual([]);
});

for (const width of [1440, 390]) test(`companion can move without toggling the conversation at ${width}px`, async ({ page }) => {
  const unexpected = await isolate(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/neo');
  await expect(page.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  const toggle = page.getByTestId('companion-ai-toggle');
  const chat = page.getByTestId('companion-ai-panel');
  const initial = (await toggle.boundingBox())!;
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.mouse.move(90, 200, { steps: 8 });
  await page.mouse.up();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chat).toHaveCount(0);
  const moved = (await toggle.boundingBox())!;
  expect(moved.x).toBeLessThan(initial.x - 50);
  expect(moved.y).toBeLessThan(initial.y - 100);
  await page.reload();
  await expect(toggle).toBeVisible();
  const restored = (await toggle.boundingBox())!;
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(2);
  await toggle.click();
  await expect(chat).toBeVisible();
  const opened = (await toggle.boundingBox())!;
  await page.mouse.move(opened.x + opened.width / 2, opened.y + opened.height / 2);
  await page.mouse.down();
  await page.mouse.move(width - 30, 100, { steps: 8 });
  await page.mouse.up();
  await expect(chat).toBeVisible();
  await toggle.press('Enter');
  await expect(chat).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(async () => {
    const box = (await toggle.boundingBox())!;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 640;
  }).toBe(true);
  expect(unexpected).toEqual([]);
});

for (const width of [1440, 390]) test(`Neo stays navigable and readable with all three appearances at ${width}px`, async ({ page }, testInfo) => {
  const unexpected = await isolate(page);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/neo');
  await expect(page.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '朝のブリーフ', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'neo');
  await expect(page.locator('.tf-main')).toHaveCSS('background-color', 'rgb(242, 248, 253)');
  await expect(page.getByRole('region', { name: 'Neo AI秘書' })).toBeVisible();
  await page.getByRole('button', { name: width === 390 ? '検索' : /検索\.\.\./ }).click();
  await expect(page.getByPlaceholder('プロジェクトやタスクを検索...')).toBeVisible();
  await page.keyboard.press('Escape');
  if (width === 390) {
    await expect(page.locator('aside')).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await expect(page.locator('aside').getByRole('link', { name: 'ダッシュボード', exact: true })).toHaveCount(1);
    await page.locator('aside').getByRole('link', { name: 'ダッシュボード', exact: true }).click();
    await expect(page.locator('aside')).toHaveCount(0);
    await chooseDashboard(page, 'Neo');
  }
  await expect(page.getByRole('region', { name: 'タスク一覧' })).toBeVisible();
  const launcher = page.getByTestId('companion-launcher');
  await expect(launcher.getByRole('button', { name: 'AIに相談する', exact: true })).toBeVisible();
  await expect(launcher.locator('img')).toHaveCount(0);
  await expect(launcher.getByRole('button', { name: /未読の通知/ })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mascotParts = launcher.locator('[data-busy] > span');
  expect(await mascotParts.count()).toBeGreaterThan(0);
  for (const part of await mascotParts.all()) await expect(part).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`neo-dashboard-${width}.png`), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'デザイン', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath(`appearance-choices-${width}.png`), animations: 'disabled' });
  await page.getByRole('radio', { name: /クラシック/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'classic');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: testInfo.outputPath(`neo-classic-${width}.png`), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'デザイン', exact: true }).click();
  await page.getByRole('radio', { name: /^Ivory/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'ivory');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tf-main')).toHaveCSS('background-color', 'rgb(247, 245, 239)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`neo-ivory-${width}.png`), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'ivory');
  expect(await page.evaluate(() => localStorage.getItem('taskflow.dashboardView.v1'))).toBe('neo');
  expect(await page.evaluate(() => localStorage.getItem('taskflow.appearance.v1'))).toBe('ivory');
  expect(unexpected).toEqual([]);
});
