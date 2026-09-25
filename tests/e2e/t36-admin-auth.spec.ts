import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login?next=%2Fadmin');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

test('only an active administrator can open A01 and its overview API', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signIn(page, process.env.T36_ADMIN_EMAIL!, process.env.T36_ADMIN_PASSWORD!);
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { name: 'A01 管理ダッシュボード' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '管理メニュー' }).getByRole('link')).toHaveCount(6);
  await expect(page.getByText(/監査ID:/)).toBeVisible();
  const apiResponse = await page.request.get('/api/admin/overview');
  expect(apiResponse.status()).toBe(200);
  expect(await apiResponse.json()).toMatchObject({
    data: { publishedProducts: expect.any(Number), outOfStockProducts: expect.any(Number), orders: expect.any(Number), notificationFailures: expect.any(Number) },
    requestId: expect.any(String),
  });
});

test('a regular member receives HTTP 403 for direct A01 and API requests', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36_MEMBER_EMAIL and T36_MEMBER_PASSWORD must identify a locally provisioned regular account');
  await signIn(page, process.env.T36_MEMBER_EMAIL!, process.env.T36_MEMBER_PASSWORD!);
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: '管理画面を利用できません' })).toBeVisible();
  const apiResponse = await page.request.get('/api/admin/overview');
  expect(apiResponse.status()).toBe(403);
  expect(await apiResponse.json()).toMatchObject({ error: { code: 'FORBIDDEN' }, requestId: expect.any(String) });
});
