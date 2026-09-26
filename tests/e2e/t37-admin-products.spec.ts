import { expect, test, type Page } from '@playwright/test';

async function signInAsAdmin(page: Page) {
  await page.goto('/login?next=%2Fadmin%2Fproducts');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/products');
}

test('A02 creates a draft, edits it, and remains usable on desktop and mobile', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: '新規商品' }).click();
  await expect(page.getByRole('heading', { name: '新規商品' })).toBeVisible();
  const suffix = `${Date.now()}`;
  const slug = `t37-e2e-${suffix}`;
  await page.getByLabel('slug', { exact: true }).fill(slug);
  await page.getByLabel('SKU', { exact: true }).fill(`T37-${suffix}`);
  await page.getByRole('button', { name: '商品を作成' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);
  await expect(page.getByRole('heading', { name: '商品を編集' })).toBeVisible();
  await expect(page.getByText(/編集版: \d+/)).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: '商品を編集' })).toBeVisible();
  await expect(page.getByLabel('対応ソケット')).toBeVisible();
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await page.getByLabel('商品名', { exact: true }).fill('T37 E2E draft');
  await page.getByLabel('公開状態').selectOption('hidden');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('商品を保存しました');
  await expect(page.getByText(/編集版: \d+/)).toBeVisible();
});
