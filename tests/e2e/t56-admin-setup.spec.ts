import { expect, test } from '@playwright/test';

test('first-admin setup stays closed after an administrator exists', async ({ page }) => {
  const state = await page.request.get('/api/admin-setup');
  expect(state.status()).toBe(200);
  expect(await state.json()).toMatchObject({ data: { available: false } });
  await page.goto('/admin-setup');
  await expect(page.getByText('初回セットアップは利用できません。管理者ログインをご利用ください。')).toBeVisible();
  await expect(page.getByLabel('初回セットアップコード')).toHaveCount(0);
});

test('a regular member cannot use the admin login as an admin', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36 member credentials must identify a locally provisioned regular account');
  await page.goto('/admin-login');
  await page.getByLabel('メールアドレス').fill(process.env.T36_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: '管理者ログイン' }).click();
  await expect(page.getByRole('alert')).toContainText('このアカウントには管理者権限がありません');
  await expect(page).toHaveURL('/admin-login');
  const apiResponse = await page.request.get('/api/admin/overview');
  expect(apiResponse.status()).toBe(401);
});
