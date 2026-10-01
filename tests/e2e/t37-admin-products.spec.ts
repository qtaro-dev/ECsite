import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES, ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES } from '../../src/lib/admin-product-image-limits';

async function signInAsAdmin(page: Page) {
  await page.goto('/login?next=%2Fadmin%2Fproducts');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/products');
}

async function noisyPng(width: number, height: number) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let state = 0x2a6d365a;
  for (let index = 0; index < pixels.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    pixels[index] = state >>> 24;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test('A02 creates a draft, edits it, and remains usable on desktop and mobile', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: '新規商品' }).click();
  await expect(page.getByRole('heading', { name: '新規商品' })).toBeVisible();
  const slugInput = page.getByLabel('商品ページURL（slug）', { exact: true });
  await expect(slugInput).toHaveAttribute('aria-describedby', 'slug-description');
  await expect(page.locator('#slug-description')).toContainText('ryzen-7-7700 → /products/ryzen-7-7700');
  const suffix = `${Date.now()}`;
  const slug = `t37-e2e-${suffix}`;
  await slugInput.fill(slug);
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
  await expect(page.locator('[role="alert"]').filter({ hasText: '4,000,000 bytes' }))
    .toContainText('4,000,000 bytes');
  await expect(page.getByLabel('画像を選択')).toHaveValue('');
});

test('T48 automatically optimizes uploads and keeps the stored object at or below one MiB', async ({ page }) => {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD || !supabaseUrl || !serviceRoleKey,
    'T36 admin account and local Supabase service credentials are required');
  await signInAsAdmin(page);
  await page.getByRole('link', { name: '新規商品' }).click();

  const suffix = `${Date.now()}`;
  await page.getByLabel('商品ページURL（slug）', { exact: true }).fill(`t48-image-${suffix}`);
  await page.getByLabel('SKU', { exact: true }).fill(`T48-${suffix}`);
  await page.getByRole('button', { name: '商品を作成' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);

  const source = await noisyPng(900, 900);
  expect(source.byteLength).toBeGreaterThan(ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES);
  expect(source.byteLength).toBeLessThanOrEqual(ADMIN_PRODUCT_IMAGE_MAX_BYTES);
  await page.getByLabel('画像を選択').setInputFiles({ name: 'large-noise.png', mimeType: 'image/png', buffer: source });
  await expect(page.getByText(/自動でリサイズ・圧縮/)).toBeVisible();

  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/admin/products') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '変更を保存' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('商品を保存しました');
  const body = await response.json() as { data?: { images?: Array<{ storagePath: string; altText: string }> } };
  const savedImage = body.data?.images?.find((image) => image.altText.includes('商品画像'));
  expect(savedImage?.storagePath).toBeTruthy();

  const storage = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await storage.storage.from('product-images').download(savedImage!.storagePath);
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  expect(data!.size).toBeLessThanOrEqual(ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES);
  const stored = Buffer.from(await data!.arrayBuffer());
  const metadata = await sharp(stored).metadata();
  expect(metadata.format).toBe('png');
  expect(metadata.width).toBeLessThan(900);
  expect(metadata.height).toBeLessThan(900);
});
