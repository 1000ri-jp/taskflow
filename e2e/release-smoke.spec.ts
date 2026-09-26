import { test, expect } from '@playwright/test';

test('production login offers real Google sign-in without test authentication', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Googleでログイン' })).toBeVisible();
  await expect(page.getByTestId('test-login')).toHaveCount(0);
  await expect(page.getByTestId('demo-login')).toHaveCount(0);
});

test('production project pages require authentication', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);
});

test('Mini never loads fictional or shared tasks without authentication', async ({ page }) => {
  await page.goto('/desktop-mini?demo=mini');
  await expect(page.getByText('TaskSlowth Miniにログイン')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

for (const route of ['/api/projects', '/api/dashboard/countdown']) {
  test(`${route} rejects an unauthenticated request`, async ({ request }) => {
    const response = await request.get(route);
    expect(response.status()).toBe(401);
  });
}
