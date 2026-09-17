import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test.describe('Board/Kanban', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);

    // Navigate to projects page
    await page.goto('/projects');

    // Wait for page to load (element-based, not networkidle due to Firebase)
    await expect(page.getByRole('button', { name: '新規プロジェクト' })).toBeVisible({ timeout: 30000 });
  });

  test('should display board view when project exists', async ({ page }) => {
    // Check for project cards in main content area (not sidebar)
    // A project card has an h3 inside a link to /board
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      console.log('No accessible projects found - skipping board tests');
      console.log('To run these tests, create a project manually in the Firebase Console');
      test.skip();
      return;
    }

    // Click on the first project
    await projectCards.first().click();

    // Should show board URL
    await expect(page).toHaveURL(/\/projects\/.*\/board/, { timeout: 10000 });

    // Board view should be visible
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });
  });

  test('should show add list button', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await projectCards.first().click();
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });
  });

  test('should create a new list', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const listName = `テストリスト_${Date.now()}`;

    await projectCards.first().click();

    // Wait for board to load
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });

    // Click add list button
    await page.click('text=リストを追加');

    // Fill in list name - use input inside the add list form
    const listInput = page.locator('input[placeholder*="リスト名"]');
    await listInput.fill(listName);

    // Submit - click the button next to the list input
    await listInput.locator('..').locator('button:has-text("追加")').click();

    // List should appear as a board list header
    await expect(page.locator(`[data-testid="board-list"] h3:has-text("${listName}")`)).toBeVisible({ timeout: 10000 });
  });

  test('should create a new task in list', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const taskTitle = `テストタスク_${Date.now()}`;

    await projectCards.first().click();

    // Wait for board to load
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible({ timeout: 10000 });

    // Check if any list exists
    const lists = page.locator('[data-testid="board-list"]');
    const listCount = await lists.count();

    if (listCount === 0) {
      await page.click('text=リストを追加');
      const listInput = page.locator('input[placeholder*="リスト名"]');
      await listInput.fill('テストリスト');
      await listInput.locator('..').locator('button:has-text("追加")').click();
      await expect(page.locator('[data-testid="board-list"]')).toBeVisible({ timeout: 10000 });
    }

    // Click add task button in first list
    const firstList = page.locator('[data-testid="board-list"]').first();
    await firstList.locator('button:has-text("タスクを追加")').click();

    // Fill in task title within the list
    const taskInput = firstList.locator('input[placeholder*="タスク"]');
    await taskInput.fill(taskTitle);

    // Click add button within the list
    await firstList.locator('button:has-text("追加")').click();

    // Task should appear
    await expect(firstList.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10000 });
  });

  test('should open task detail modal when clicking task', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await projectCards.first().click();

    // Wait for board to load
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });

    // Create list and task if needed
    const addTaskButtons = page.locator('button:has-text("タスクを追加")');
    const listCount = await addTaskButtons.count();

    if (listCount === 0) {
      await page.click('text=リストを追加');
      await page.fill('input[placeholder*="リスト名"]', 'テストリスト');
      await page.click('button:has-text("追加")');
      await expect(page.locator('button:has-text("タスクを追加")')).toBeVisible({ timeout: 10000 });
    }

    // Look for existing tasks or create one
    const taskCards = page.locator('[data-testid="task-card"]');
    const taskCount = await taskCards.count();

    if (taskCount === 0) {
      const list = page.locator('[data-testid="board-list"]').first();
      await list.locator('button:has-text("タスクを追加")').click();
      await list.locator('input[placeholder*="タスク"]').fill('テストタスク');
      await list.locator('button:has-text("追加")').click();
      await page.waitForTimeout(1000);
    }

    // Click on first task
    await page.locator('[data-testid="task-card"]').first().click();

    // Modal should open
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  });

  test('should show task tabs in detail modal', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    await projectCards.first().click();

    // Wait for board to load
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });

    // Create list and task if needed
    const addTaskButtons = page.locator('button:has-text("タスクを追加")');
    const listCount = await addTaskButtons.count();

    if (listCount === 0) {
      await page.click('text=リストを追加');
      await page.fill('input[placeholder*="リスト名"]', 'テストリスト');
      await page.click('button:has-text("追加")');
      await expect(page.locator('button:has-text("タスクを追加")')).toBeVisible({ timeout: 10000 });
    }

    const taskCards = page.locator('[data-testid="task-card"]');
    const taskCount = await taskCards.count();

    if (taskCount === 0) {
      const list = page.locator('[data-testid="board-list"]').first();
      await list.locator('button:has-text("タスクを追加")').click();
      await list.locator('input[placeholder*="タスク"]').fill('テストタスク');
      await list.locator('button:has-text("追加")').click();
      await page.waitForTimeout(1000);
    }

    await page.locator('[data-testid="task-card"]').first().click();

    // Check modal elements are visible
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    // Check for elements that are always present
    await expect(page.getByRole('button', { name: 'チェックリスト', exact: true })).toBeVisible();
    await expect(page.locator('text=優先度')).toBeVisible();
  });

  test('should toggle auto-set-start-date option in list menu', async ({ page }) => {
    const projectCards = page.locator('main a[href*="/board"] h3');
    const count = await projectCards.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const listName = `開始日リスト_${Date.now()}`;

    await projectCards.first().click();
    await expect(page.locator('text=リストを追加')).toBeVisible({ timeout: 10000 });

    // Create a fresh list
    await page.click('text=リストを追加');
    const listInput = page.locator('input[placeholder*="リスト名"]');
    await listInput.fill(listName);
    await listInput.locator('..').locator('button:has-text("追加")').click();

    const list = page.locator(`[data-testid="board-list"]:has(h3:has-text("${listName}"))`);
    await expect(list).toBeVisible({ timeout: 10000 });

    // Open list dropdown menu and toggle the option
    await list.locator('button:has(svg.lucide-more-horizontal), button:has(svg.lucide-ellipsis)').first().click();
    const menuItem = page.getByRole('menuitem', { name: 'ここに入ったら開始日を設定' });
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click();

    // Reopen the menu and verify the ON indicator
    await list.locator('button:has(svg.lucide-more-horizontal), button:has(svg.lucide-ellipsis)').first().click();
    await expect(
      page.getByRole('menuitem', { name: /ここに入ったら開始日を設定/ }).locator('text=ON')
    ).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');

    // Create a task in the list — startDate should be set automatically
    await list.locator('button:has-text("タスクを追加")').first().click();
    const taskTitle = `開始日タスク_${Date.now()}`;
    await list.locator('input[placeholder*="タスク"]').fill(taskTitle);
    await list.locator('button:has-text("追加")').click();
    await expect(list.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10000 });
  });
});
