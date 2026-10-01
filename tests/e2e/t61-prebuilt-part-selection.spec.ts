import { expect, test } from '@playwright/test';

test('legacy published PC stays visible and requires registered-part reselection before editing', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await page.goto('/login?next=%2Fadmin%2Fproducts');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/products');
  await page.getByLabel('商品名・ブランド・SKU・slug').fill('demo-gaming-pc-01');
  await page.getByRole('button', { name: '検索' }).click();
  const row = page.getByRole('row').filter({ hasText: 'demo-gaming-pc-01' });
  await expect(row).toContainText('旧構成・パーツ未選択');
  await row.getByRole('link', { name: '編集' }).click();
  await expect(page.getByText('このPCは旧方式の構成です。')).toBeVisible();
  await expect(page.getByText(/旧構成: Demo CPU G1/)).toBeVisible();
  await page.getByLabel('商品名').fill('保存できない変更');
  await page.getByLabel('公開状態').selectOption('draft');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('alert')).toContainText('採用パーツを選び直してから保存してください');
});
