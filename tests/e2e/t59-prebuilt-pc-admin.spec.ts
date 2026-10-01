import { expect, test, type Page } from '@playwright/test';

async function signInAsAdmin(page: Page) {
  await page.goto('/login?next=%2Fadmin%2Fproducts');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/products');
}

async function inventoryFor(page: Page, productId: string) {
  const first = await page.request.get('/api/admin/inventory');
  expect(first.status()).toBe(200);
  const data = (await first.json()).data;
  for (let pageNumber = 1; pageNumber <= data.totalPages; pageNumber++) {
    const response = pageNumber === 1 ? first : await page.request.get(`/api/admin/inventory?page=${pageNumber}`);
    expect(response.status()).toBe(200);
    const item = (await response.json()).data.items.find((entry: { productId: string }) => entry.productId === productId);
    if (item) return item;
  }
  return null;
}

test('T59 creates and edits a prebuilt PC draft, retains the free-text configuration, and leaves stock unchanged', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);
  await expect(page.getByRole('link', { name: '構成済みPCを登録' })).toBeVisible();
  await page.getByRole('link', { name: '構成済みPCを登録' }).click();
  await expect(page.getByRole('heading', { name: '構成済みPCを登録' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  const slug = `t59-prebuilt-${Date.now()}`;
  const sku = `T59-PC-${Date.now()}`;
  const slugInput = page.getByLabel('商品ページURL（slug）', { exact: true });
  await expect(slugInput).toHaveAttribute('aria-describedby', 'slug-description');
  await expect(page.locator('#slug-description')).toContainText('ryzen-7-7700 → /products/ryzen-7-7700');
  await slugInput.fill(slug);
  await page.getByLabel('完成PCのSKU').fill(sku);
  await page.getByLabel('商品名').fill('T59 テスト構成済みPC');
  await page.getByLabel('ブランド').fill('T59 Labs');
  const componentData = [
    ['CPU', 'Ryzen 7 Test', '8コア / テスト用'], ['GPU', 'Radeon Test', '16GB / テスト用'],
    ['メモリ', 'DDR5 Test', '32GB / 2枚'], ['SSD', 'NVMe Test', '1TB / Gen4'],
    ['マザーボード', 'Test Board', 'ATX / AM5'],
  ] as const;
  for (const [label, part, details] of componentData) {
    const group = page.locator('fieldset').filter({ has: page.getByText(new RegExp(`^${label}`)) }).first();
    await group.getByLabel('パーツ名').fill(part);
    await group.getByLabel('詳細・仕様').fill(details);
  }
  await page.getByLabel('ゲーム').check();
  await page.getByLabel('動画編集').check();
  const mobileWidths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(mobileWidths.document).toBeLessThanOrEqual(mobileWidths.viewport);
  const mobileSubmit = await page.getByRole('button', { name: '構成済みPCを作成' }).boundingBox();
  expect(mobileSubmit?.height).toBeGreaterThanOrEqual(44);
  // Chromium CSS zoom emulates the 640-device-pixel / 200% reflow target.
  await page.setViewportSize({ width: 640, height: 900 });
  const zoomed = await page.evaluate(() => {
    document.documentElement.style.zoom = '200%';
    const controls = [...document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]), select, textarea, button, .uses label')]
      .filter((control) => control.getBoundingClientRect().width > 0);
    return {
      zoom: getComputedStyle(document.documentElement).zoom,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      controlsAtLeast44px: controls.every((control) => control.getBoundingClientRect().height >= 44),
    };
  });
  expect(zoomed.zoom).toBe('2');
  expect(zoomed.documentWidth).toBeLessThanOrEqual(zoomed.viewportWidth);
  expect(zoomed.controlsAtLeast44px).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.getByRole('button', { name: '構成済みPCを作成' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/prebuilt-pcs\/[0-9a-f-]+(?:\?saved=1)?$/i);
  await expect(page.getByRole('status')).toContainText('構成済みPCを保存しました');
  const productId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.locator('#cpu-label')).toHaveValue('Ryzen 7 Test');
  await expect(page.locator('#motherboard-label')).toHaveValue('Test Board');
  await expect(page.getByLabel('ゲーム')).toBeChecked();

  const beforeStock = await inventoryFor(page, productId);
  expect(beforeStock).not.toBeNull();
  const stockState = { onHand: beforeStock!.onHand, allocated: beforeStock!.allocated, version: beforeStock!.version };
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByLabel('商品名').fill('T59 更新済み構成済みPC');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5KsAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('画像を選択').setInputFiles({ name: 't59.png', mimeType: 'image/png', buffer: image });
  await page.getByLabel('新しい画像の代替テキスト').fill('T59 PC 正面');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('構成済みPCを保存しました');
  await expect(page.getByLabel('代替テキスト')).toHaveValue('T59 PC 正面');
  await page.reload();
  await expect(page.getByLabel('商品名')).toHaveValue('T59 更新済み構成済みPC');
  await expect(page.getByLabel('新しい画像の代替テキスト')).toHaveCount(0);
  await expect(page.getByLabel('代替テキスト')).toHaveValue('T59 PC 正面');
  await page.getByRole('button', { name: '画像を削除' }).click();
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('構成済みPCを保存しました');
  await expect(page.getByLabel('代替テキスト')).toHaveCount(0);
  const afterStock = await inventoryFor(page, productId);
  expect(afterStock).not.toBeNull();
  expect({ onHand: afterStock!.onHand, allocated: afterStock!.allocated, version: afterStock!.version }).toEqual(stockState);

  await page.setViewportSize({ width: 1280, height: 900 });
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  const mainButton = await page.getByRole('button', { name: '変更を保存' }).boundingBox();
  expect(mainButton?.height).toBeGreaterThanOrEqual(44);
});

test('T59 maps publish requirements and stale-save conflicts without discarding entered values', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);
  await page.goto('/admin/prebuilt-pcs/new');
  await page.getByLabel('商品ページURL（slug）', { exact: true }).fill(`t59-error-${Date.now()}`);
  await page.getByLabel('完成PCのSKU').fill(`T59-ERR-${Date.now()}`);
  await page.getByLabel('公開状態').selectOption('published');
  await page.getByRole('button', { name: '構成済みPCを作成' }).click();
  await expect(page.getByText('公開には入力が必要です。').first()).toBeVisible();
  const missingComponents = page.getByRole('alert').filter({ hasText: '公開にはCPU・GPU・メモリ・SSDの構成が必要です。' });
  await expect(missingComponents).toBeVisible();
  await expect(page.locator('section[aria-labelledby="components-title"]')).toHaveAttribute('aria-describedby', /components-schema-error/);

  await page.getByLabel('公開状態').selectOption('draft');
  await page.getByLabel('商品名').fill('T59 conflict fixture');
  await page.getByRole('button', { name: '構成済みPCを作成' }).click();
  await expect(page).toHaveURL(/\/admin\/prebuilt-pcs\/[0-9a-f-]+(?:\?saved=1)?$/i);
  await page.getByLabel('商品名').fill('入力保持を確認する名前');
  await page.route('**/api/admin/prebuilt-pcs', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'conflict' }, requestId: 'test' }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('status')).toContainText('別の管理者が先に更新しました');
  await expect(page.getByLabel('商品名')).toHaveValue('入力保持を確認する名前');
});

test('T59 route remains protected from regular members', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36_MEMBER_EMAIL and T36_MEMBER_PASSWORD must identify a locally provisioned regular account');
  await page.goto(`/login?next=${encodeURIComponent('/admin/prebuilt-pcs/new')}`);
  await page.getByLabel('メールアドレス').fill(process.env.T36_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  const response = await page.goto('/admin/prebuilt-pcs/new');
  expect(response?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: '管理画面を利用できません' })).toBeVisible();
  const api = await page.request.get('/api/admin/prebuilt-pcs');
  expect(api.status()).toBe(403);
});
