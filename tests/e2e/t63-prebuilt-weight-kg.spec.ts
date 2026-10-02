import { expect, test, type Page } from '@playwright/test';

async function signInAdmin(page: Page) {
  await page.goto('/login?next=%2Fadmin%2Fproducts');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/products');
  await page.goto('/admin/prebuilt-pcs/new');
}

test('prebuilt PC weight is edited in kg and saved as integer grams', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAdmin(page);
  await expect(page).toHaveURL('/admin/prebuilt-pcs/new');

  const stamp = Date.now();
  await page.getByLabel('商品ページURL（slug）', { exact: true }).fill(`t63-weight-${stamp}`);
  await page.getByLabel('完成PCのSKU').fill(`T63-WEIGHT-${stamp}`);
  const weight = page.getByRole('textbox', { name: '商品重量（kg）' });
  await weight.fill('0.5');
  await expect(page.getByText('約0.5kg')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await weight.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 640, height: 900 });
  const zoomed = await page.evaluate(() => {
    document.documentElement.style.zoom = '200%';
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth };
  });
  expect(zoomed.documentWidth).toBeLessThanOrEqual(zoomed.viewportWidth);
  expect((await weight.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  const createRequest = page.waitForRequest((request) => request.url().endsWith('/api/admin/prebuilt-pcs') && request.method() === 'POST');
  await page.getByRole('button', { name: '構成済みPCを作成' }).click();
  expect((await createRequest).postData()).toContain('"weightG":500');
  await expect(page).toHaveURL(/\/admin\/prebuilt-pcs\/[0-9a-f-]+(?:\?saved=1)?$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1)!;
  const stored = await page.request.get(`/api/admin/prebuilt-pcs?productId=${productId}`);
  expect(stored.status()).toBe(200);
  expect((await stored.json()).data.weightG).toBe(500);
  await page.reload();
  await expect(weight).toHaveValue('0.5');
  await expect(page.getByText('約0.5kg')).toBeVisible();

  await weight.fill('30.001');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('#weight-kg-error-0')).toContainText('30kg以下');
  await expect(weight).toHaveAttribute('aria-invalid', 'true');
  await weight.fill('20');
  const updateRequest = page.waitForRequest((request) => request.url().endsWith('/api/admin/prebuilt-pcs') && request.method() === 'PATCH');
  await page.getByRole('button', { name: '変更を保存' }).click();
  expect((await updateRequest).postData()).toContain('"weightG":20000');
  await expect(page.getByRole('status').filter({ hasText: '構成済みPCを保存しました' })).toBeVisible();
  await page.reload();
  await expect(weight).toHaveValue('20');
  expect((await (await page.request.get(`/api/admin/prebuilt-pcs?productId=${productId}`)).json()).data.weightG).toBe(20_000);
});

test('published prebuilt PC requires weight in kg', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAdmin(page);
  await page.getByLabel('公開状態').selectOption('published');
  await page.getByRole('button', { name: '構成済みPCを作成' }).click();
  await expect(page.locator('#weight-kg-error-0')).toContainText('公開には商品重量（kg）の入力が必要');
});
