import { expect, test } from '@playwright/test';

test('administrator can retry a failed logout and then ends the session', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');

  await page.goto('/admin-login');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: '管理者ログイン' }).click();
  await expect(page).toHaveURL('/admin');

  const logoutButton = page.getByRole('button', { name: '管理者ログアウト' });
  await expect(logoutButton).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(logoutButton).toBeVisible();
  expect((await logoutButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.goto('/admin/products');
  await expect(page.getByRole('button', { name: '管理者ログアウト' })).toBeVisible();
  await page.goto('/admin');
  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' });
  }, { times: 1 });
  await logoutButton.click();
  await expect(page.getByRole('alert')).toContainText('ログアウトできませんでした');
  await expect(logoutButton).toBeEnabled();
  await expect(page).toHaveURL('/admin');

  await logoutButton.click();
  await expect(page).toHaveURL('/admin-login');
  await expect(page.getByRole('heading', { name: '管理者ログイン' })).toBeVisible();
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  const apiResponse = await page.request.get('/api/admin/overview');
  expect(apiResponse.status()).toBe(401);
});
