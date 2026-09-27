import { expect, test, type Page } from '@playwright/test';

async function signInAsAdmin(page: Page) {
  await page.goto('/login?next=%2Fadmin%2Finventory');
  await page.getByLabel('メールアドレス').fill(process.env.T36_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/admin/inventory');
}

test('A03 adjusts inventory with a reason and reports current values on invalid reductions', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36_ADMIN_EMAIL and T36_ADMIN_PASSWORD must identify a locally provisioned admin account');
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 320, height: 812 });
  await expect(page.getByRole('heading', { name: '在庫調整' })).toBeVisible();
  const response = await page.request.get('/api/admin/inventory');
  expect(response.status()).toBe(200);
  const inventory = (await response.json()).data;
  expect(inventory.pageSize).toBe(50);
  expect(inventory.items[0]).toMatchObject({ onHand: expect.any(Number), allocated: expect.any(Number), available: expect.any(Number), version: expect.any(Number) });
  if (inventory.totalPages > 1) {
    const pageTwoResponse = await page.request.get('/api/admin/inventory?page=2');
    expect(pageTwoResponse.status()).toBe(200);
    const pageTwo = (await pageTwoResponse.json()).data;
    expect(pageTwo.page).toBe(2);
    expect(pageTwo.total).toBe(inventory.total);
    const firstPageIds = new Set(inventory.items.map((item: { productId: string }) => item.productId));
    expect(pageTwo.items.every((item: { productId: string }) => !firstPageIds.has(item.productId))).toBe(true);
  }
  if (!inventory.items.length) test.skip(true, 'A03 needs at least one product fixture');

  const first = inventory.items[0];
  const card = page.locator('article').filter({ hasText: first.sku });
  await card.getByLabel(`${first.name}の増減数`).fill('1');
  await card.getByLabel(`${first.name}の調整理由`).fill('T38 E2E 入庫');
  await card.getByRole('button', { name: '在庫を調整' }).click();
  await expect(card.getByRole('status')).toContainText('在庫を調整しました');
  const adjustedOnHand = first.onHand + 1;
  await expect(card.locator('dl').getByText(String(adjustedOnHand), { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '最近の調整履歴' })).toContainText('T38 E2E 入庫');

  const invalidPage = await page.request.get('/api/admin/inventory?page=0');
  expect(invalidPage.status()).toBe(400);
  const invalidDelta = -(adjustedOnHand - first.allocated + 1);
  await card.getByLabel(`${first.name}の増減数`).fill(String(invalidDelta));
  await card.getByLabel(`${first.name}の調整理由`).fill('T38 E2E 不正削減');
  await card.getByRole('button', { name: '在庫を調整' }).click();
  await expect(card.getByRole('alert')).toContainText(/引当数より少なく|0未満/);
  await expect(card.locator('dl').getByText(String(adjustedOnHand), { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test('a regular member cannot read or adjust admin inventory', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36_MEMBER_EMAIL and T36_MEMBER_PASSWORD must identify a locally provisioned regular account');
  await page.goto('/login?next=%2Faccount');
  await page.getByLabel('メールアドレス').fill(process.env.T36_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  const response = await page.request.get('/api/admin/inventory');
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
});
