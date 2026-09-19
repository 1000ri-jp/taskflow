import { test, expect } from '@playwright/test';

test('Neo secretary: evidence → personal hold → new reply → adoption → shared completion → undo → reload', async ({ page }) => {
  await page.goto('/neo');
  const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByText('架空データを動かして検証', { exact: true }).click();
  await panel.getByRole('button', { name: '架空データを初期化', exact: true }).click();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  let draft = panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true });
  await draft.getByRole('button', { name: 'この条件で預ける', exact: true }).click();
  await expect(page.getByTestId('neo-personal-waiting').getByRole('region', { name: '待ち・保留' })).toContainText('案内文を仕上げる');
  await expect(page.getByRole('region', { name: '今日の仕事・期限' })).toBeVisible();
  await panel.getByRole('button', { name: '返信・画像到着', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '余裕があるとき' })).toHaveCount(0);
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  await expect(panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  const extra = page.getByRole('dialog', { name: '余裕があるとき' });
  const choice = extra.getByRole('article', { name: '今日の一歩候補: 案内文を仕上げる', exact: true });
  if (!(await choice.isVisible())) await extra.getByText('候補を選ぶ', { exact: true }).click();
  await expect(choice).toContainText('画像が到着');
  await choice.getByRole('button', { name: '今日の一歩にする', exact: true }).click();
  await expect(extra.getByRole('heading', { name: '案内文を仕上げる', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('dialog', { name: '余裕があるとき' })).toHaveCount(0);
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '余裕があるとき' })).toContainText('案内文を仕上げる');
  await page.keyboard.press('Escape');
  await panel.getByText('架空データを動かして検証', { exact: true }).click();
  await panel.getByRole('button', { name: '完了報告', exact: true }).click();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  draft = panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true });
  await draft.getByText('根拠・訂正・共有への反映', { exact: true }).click();
  await expect(draft).toContainText('案内文の修正と確認が完了しました。');
  await draft.getByRole('button', { name: '共有タスクの完了も反映…', exact: true }).click();
  await draft.getByRole('button', { name: '共有の完了を反映', exact: true }).click();
  await panel.getByText('架空の実タスク状態', { exact: true }).click();
  await expect(panel.getByText('案内文を仕上げる：完了', { exact: false })).toBeVisible();
  await panel.getByText('AI秘書の履歴・設定', { exact: true }).click();
  await panel.getByRole('button', { name: '採用を戻す', exact: true }).click();
  await expect(panel.getByText(/^案内文を仕上げる：未完了/)).toBeVisible();
});

test('partial acquisition disables adoption, and recovered data remains distinct from empty', async ({ page }) => {
  await page.goto('/neo'); const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  await panel.getByText('架空データを動かして検証', { exact: true }).click();
  await panel.getByRole('button', { name: 'コメント取得失敗', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('一部の情報を取得できていません');
  await expect(panel.getByRole('button', { name: '整理', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '今日の一歩', exact: true })).toBeDisabled();
  for (const button of await panel.getByRole('button', { name: /^(この判断を採用|今日の一歩に追加|この条件で預ける|期限変更: .+|不要: .+)$/ }).all()) await expect(button).toBeDisabled();
  await panel.getByRole('button', { name: '取得を回復', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '整理', exact: true })).toBeEnabled();
});

test('mobile layout preserves the primary decision and important deadlines without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/neo');
  if (await page.locator('aside').isVisible()) await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  await expect(page.getByRole('button', { name: '今日の一歩', exact: true })).toBeVisible();
  await expect(panel.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '今日の仕事・期限' })).toBeVisible();
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  const extra = page.getByRole('dialog', { name: '余裕があるとき' });
  await expect(extra).toBeVisible();
  await extra.getByText('余裕の時間で絞る', { exact: true }).click();
  await expect(extra.getByRole('spinbutton', { name: '使える時間', exact: true })).toBeVisible();
  expect(await extra.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && [...element.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => {
      const control = button.getBoundingClientRect();
      return control.left >= bounds.left && control.right <= bounds.right;
    });
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/secretary-extra-390.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true }).scrollIntoViewIfNeeded();
  const overflow = await panel.getByTestId('secretary-status-actions').evaluateAll(rows => rows.flatMap(row => {
    const bounds = row.getBoundingClientRect();
    const outside = [...row.querySelectorAll('button')].filter(button => {
      const control = button.getBoundingClientRect();
      return control.left < bounds.left - 1 || control.right > bounds.right + 1;
    }).map(button => button.getAttribute('aria-label') || button.textContent);
    return row.scrollWidth > row.clientWidth || bounds.left < 0 || bounds.right > window.innerWidth || outside.length
      ? [{ task: row.closest('article')?.getAttribute('aria-label'), outside, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth }] : [];
  }));
  expect(overflow).toEqual([]);
  await page.screenshot({ path: 'test-results/secretary-card-390.png', animations: 'disabled' });
  await page.getByTestId('neo-personal-waiting').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/secretary-waiting-390.png', animations: 'disabled' });
});

test('foreground re-evaluation reacts to changed evidence but does not adopt it', async ({ page }) => {
  await page.goto('/neo'); const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  await panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true }).getByRole('button', { name: 'この条件で預ける', exact: true }).click();
  await panel.getByText('AI秘書の履歴・設定', { exact: true }).click();
  await panel.getByRole('checkbox', { name: 'この画面で情報が変わったら自動で再整理する', exact: true }).check();
  await panel.getByText('架空データを動かして検証', { exact: true }).click();
  await panel.getByRole('button', { name: '返信・画像到着', exact: true }).click();
  await panel.getByRole('button', { name: '情報を更新', exact: true }).click();
  await expect(page.getByTestId('neo-personal-waiting').getByRole('region', { name: '待ち・保留' })).not.toContainText('案内文を仕上げる');
  await expect(panel.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '余裕があるとき' })).toHaveCount(0);
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  const extra = page.getByRole('dialog', { name: '余裕があるとき' });
  const choice = extra.getByRole('article', { name: '今日の一歩候補: 案内文を仕上げる', exact: true });
  if (!(await choice.isVisible())) await extra.getByText('候補を選ぶ', { exact: true }).click();
  await expect(choice).toContainText('画像が到着');
  await expect(extra.getByRole('heading', { name: '案内文を仕上げる', level: 3, exact: true })).toHaveCount(0);
  const disposition = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('taskflow-secretary-lab-v1:'))!;
    const work = JSON.parse(localStorage.getItem(key)!);
    return {
      status: work.state.proposals.find((proposal: { key: string }) => proposal.key === 'secretary-demo/draft')?.status,
      adopted: work.state.decisions.some((decision: { key: string; disposition: string }) => decision.key === 'secretary-demo/draft' && decision.disposition === 'execute'),
    };
  });
  expect(disposition).toEqual({ status: 'pending', adopted: false });
});

test('deadline changes save only the schedule and remain undoable after re-evaluation and reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T03:00:00.000Z'));
  await page.goto('/neo');
  const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  const storageKey = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith('taskflow-secretary-lab-v1:'))!);
  expect(storageKey).toBeTruthy();
  await page.evaluate(key => {
    const work = JSON.parse(localStorage.getItem(key)!);
    Object.assign(work.tasks.find((task: { taskId: string }) => task.taskId === 'draft'), {
      startDate: '2026-09-10T00:00:00.000Z', dueDate: '2026-09-12T00:00:00.000Z', durationDays: 3, isDueDateFixed: false,
    });
    localStorage.setItem(key, JSON.stringify(work));
  }, storageKey);
  const readWork = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
  const readTask = async () => (await readWork()).tasks.find((task: { taskId: string }) => task.taskId === 'draft');
  const before = await readTask();
  await page.reload();
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  const title = '案内文を仕上げる';
  const task = panel.getByRole('article', { name: `提案: ${title}`, exact: true });
  await task.getByRole('button', { name: `期限変更: ${title}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: `期限変更: ${title}`, exact: true });
  await expect(editor.getByLabel('新しい期限')).toHaveValue('2026-09-12');
  await editor.getByRole('button', { name: /^来週 / }).click();
  await expect(editor.getByLabel('新しい期限')).toHaveValue('2026-09-14');
  await editor.getByRole('button', { name: /^来月 / }).click();
  await expect(editor.getByLabel('新しい期限')).toHaveValue('2026-10-01');
  expect(await readTask()).toEqual(before);
  expect((await readWork()).state.history).toHaveLength(0);
  await editor.getByRole('button', { name: '期限を変更', exact: true }).click();
  await expect.poll(readTask).toEqual({ ...before, dueDate: '2026-10-01T00:00:00.000Z', durationDays: 22, isDueDateFixed: true });
  await expect(editor).toHaveCount(0);
  const change = (await readWork()).state.history.find((history: { action: string }) => history.action === 'reschedule');
  expect(change.beforeTask).toEqual({ dueDate: before.dueDate, durationDays: 3, isDueDateFixed: false });
  expect(change.afterTask).toEqual({ dueDate: '2026-10-01T00:00:00.000Z', durationDays: 22, isDueDateFixed: true });
  await page.reload();
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  await expect.poll(async () => (await readWork()).state.proposals.some((proposal: { id: string }) => proposal.id === change.proposalId)).toBe(false);
  await panel.getByText('AI秘書の履歴・設定', { exact: true }).click();
  await panel.getByRole('button', { name: '期限変更を戻す', exact: true }).click();
  await expect.poll(readTask).toEqual(before);
  await expect.poll(async () => (await readWork()).state.history.find((history: { id: string }) => history.id === change.id)?.undone).toBe(true);
  await page.reload();
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  expect(await readTask()).toEqual(before);
});


test('ready tasks remain selectable without shared writes, while personal waiting stays beside the task list', async ({ page }) => {
  await page.goto('/neo');
  const panel = page.getByRole('region', { name: 'Neo AI秘書' });
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: '整理', exact: true }).click();
  const decisions = panel.getByRole('region', { name: '確認・判断が必要', exact: true });
  const waitingTarget = page.getByTestId('neo-personal-waiting');
  const waiting = waitingTarget.getByRole('region', { name: '待ち・保留', exact: true });
  const title = '公開用の紹介文を整える';
  await expect(panel.getByRole('region', { name: '着手できる', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('article', { name: `提案: ${title}`, exact: true })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: '待ち・保留', exact: true })).toHaveCount(0);
  await expect(waiting.getByText('0件', { exact: true })).toBeVisible();
  const listBounds = (await page.getByRole('region', { name: 'タスク一覧', exact: true }).boundingBox())!;
  const waitingBounds = (await waitingTarget.boundingBox())!;
  const panelBounds = (await panel.boundingBox())!;
  expect(Math.abs(waitingBounds.x - listBounds.x)).toBeLessThan(2);
  expect(waitingBounds.y).toBeGreaterThanOrEqual(listBounds.y + listBounds.height - 1);
  expect(waitingBounds.x + waitingBounds.width).toBeLessThanOrEqual(panelBounds.x);
  const readWork = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('taskflow-secretary-lab-v1:'))!;
    return JSON.parse(localStorage.getItem(key)!);
  });
  const before = await readWork();
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  const extra = page.getByRole('dialog', { name: '余裕があるとき' });
  const choice = extra.getByRole('article', { name: `今日の一歩候補: ${title}`, exact: true });
  if (!(await choice.isVisible())) await extra.getByText('候補を選ぶ', { exact: true }).click();
  await expect(choice).toContainText('公開準備のために着手できます。');
  await expect(choice).toContainText('15分');
  expect(await readWork()).toEqual(before);
  await choice.getByRole('button', { name: title, exact: true }).click();
  await expect(page.locator('#mock-task-details')).toHaveAttribute('open', '');
  expect(await readWork()).toEqual(before);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  if (!(await choice.isVisible())) await extra.getByText('候補を選ぶ', { exact: true }).click();
  await choice.getByRole('button', { name: '今日の一歩にする', exact: true }).click();
  await expect.poll(async () => (await readWork()).state.decisions.find((decision: { key: string }) => decision.key === 'secretary-demo/ready')?.disposition).toBe('execute');
  expect((await readWork()).tasks).toEqual(before.tasks);
  await page.keyboard.press('Escape');
  await decisions.getByRole('article', { name: '提案: 案内文を仕上げる', exact: true }).getByRole('button', { name: 'この条件で預ける', exact: true }).click();
  await expect(waiting.getByText('1件', { exact: true })).toBeVisible();
  const unnecessary = '別の告知案を考える';
  await decisions.getByRole('article', { name: `提案: ${unnecessary}`, exact: true }).getByRole('button', { name: `不要: ${unnecessary}`, exact: true }).click();
  await expect(waiting.getByText('1件', { exact: true })).toBeVisible();
  await waiting.locator('summary').click();
  await expect(waiting.getByRole('button', { name: '案内文を仕上げる', exact: true })).toBeVisible();
  await expect(waiting).not.toContainText(unnecessary);
  await expect.poll(async () => (await readWork()).state.decisions.find((decision: { key: string }) => decision.key === 'secretary-demo/idea')?.disposition).toBe('unneeded');
  expect((await readWork()).tasks).toEqual(before.tasks);
  await page.reload();
  await expect(panel.getByText('ローカル検証用・架空データ。', { exact: false })).toBeVisible();
  await expect(waiting).not.toContainText(unnecessary);
  await expect(waiting.getByText('1件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '今日の一歩', exact: true }).click();
  await expect(extra.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect((await readWork()).tasks).toEqual(before.tasks);
});
