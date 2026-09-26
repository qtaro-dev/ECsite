import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

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

  await page.getByLabel('商品名', { exact: true }).fill('T37 E2E published CPU');
  await page.getByLabel('ブランド', { exact: true }).fill('T37 Labs');
  await page.getByLabel('商品説明', { exact: true }).fill('Synthetic publish-flow fixture');
  await page.getByLabel('初心者向けメモ', { exact: true }).fill('Synthetic fixture only');
  await page.getByLabel('税込価格（円）').fill('1000');
  await page.getByLabel('商品重量（g）').fill('500');
  await page.getByLabel('梱包後の長さ（mm）').fill('100');
  await page.getByLabel('梱包後の幅（mm）').fill('100');
  await page.getByLabel('梱包後の高さ（mm）').fill('100');
  const validPng = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await page.getByLabel('画像を選択').setInputFiles({
    name: 't37-published.png', mimeType: 'image/png', buffer: validPng,
  });
  await expect(page.getByText(/選択済み: t37-published\.png/)).toBeVisible();
  await page.getByLabel('公開状態').selectOption('published');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('商品を保存しました');
  await expect(page.getByLabel('公開状態')).toHaveValue('published');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: '商品を編集' })).toBeVisible();
  await expect(page.getByLabel('対応ソケット')).toBeVisible();
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await page.getByLabel('商品名', { exact: true }).fill('T37 E2E hidden');
  await page.getByLabel('公開状態').selectOption('hidden');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('商品を保存しました');
  await expect(page.getByLabel('公開状態')).toHaveValue('hidden');
  await expect(page.getByText(/編集版: \d+/)).toBeVisible();
});

test('A02 rejects an image above the approved four-million-byte cap in the browser', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);
  await page.getByRole('link', { name: '新規商品' }).click();
  await page.getByLabel('画像を選択').setInputFiles({
    name: 'over-limit.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(4_000_001),
  });
  await expect(page.getByRole('alert')).toContainText('4,000,000 bytes');
  await expect(page.getByLabel('画像を選択')).toHaveValue('');
});
