import { expect, test } from '@playwright/test';

test('administrator can retry a failed logout and then ends the session', async ({ page, browser }) => {
  test.skip(!process.env.T60_ADMIN_EMAIL || !process.env.T60_ADMIN_PASSWORD || !process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T60_ADMIN_EMAIL and T60_ADMIN_PASSWORD must identify a locally provisioned admin account');

  // A separate administrator session must survive the logout under test.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto('/admin-login');
  await other.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await other.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await other.getByRole('button', { name: '管理者ログイン' }).click();
  await expect(other).toHaveURL('/admin');

  await page.goto('/admin-login');
  await page.getByLabel('メールアドレス').fill(process.env.T60_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T60_ADMIN_PASSWORD!);
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
  await expect(page.getByRole('alert').filter({ hasText: 'ログアウトできませんでした' }))
    .toContainText('ログアウトできませんでした。時間をおいて再度お試しください。');
  await expect(logoutButton).toBeEnabled();
  await expect(page).toHaveURL('/admin');

  await logoutButton.click();
  await expect(page).toHaveURL('/admin-login');
  await expect(page.getByRole('heading', { name: '管理者ログイン' })).toBeVisible();
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  const apiResponse = await page.request.get('/api/admin/overview');
  expect(apiResponse.status()).toBe(401);
  const otherResponse = await other.goto('/admin');
  expect(otherResponse?.status()).toBe(200);
  expect((await other.request.get('/api/admin/overview')).status()).toBe(200);
  await otherContext.close();
});
