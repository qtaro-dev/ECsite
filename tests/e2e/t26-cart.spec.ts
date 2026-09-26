import { expect, test, type Page } from '@playwright/test';

type CartItem = {
  productId: string;
  quantity: number;
  unitPriceYen: number;
  lineTotalYen: number;
  availableQuantity: number;
  name?: string;
  slug?: string;
  brand?: string;
  sku?: string;
  imagePath?: string | null;
  unitPriceAtAddYen?: number | null;
  availabilityState?: 'available' | 'sold_out' | 'unavailable';
};
type CartState = { items: CartItem[]; goodsTotalYen: number; estimatedShippingYen: number | null };
const sampleProductId = '00000000-0000-4000-8000-000000000261';

function setCartRoutes(page: Page, initial: CartState) {
  let state = initial;
  page.route('**/api/cart**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state, requestId: 't26-cart-get' }) });
      return;
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { productId: string; quantity: number };
      const existing = state.items.find((item) => item.productId === body.productId);
      const template = existing ?? { productId: body.productId, quantity: body.quantity, unitPriceYen: 890, lineTotalYen: 890 * body.quantity,
        availableQuantity: 5, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
        imagePath: null, unitPriceAtAddYen: 1000, availabilityState: 'available' as const };
      if (body.quantity > template.availableQuantity) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', currentCart: state }, requestId: 't26-cart-conflict' }) });
        return;
      }
      const items = state.items.filter((item) => item.productId !== body.productId);
      const updated: CartItem = { ...template, quantity: body.quantity, lineTotalYen: template.unitPriceYen * body.quantity };
      items.push(updated);
      const goodsTotalYen = items.reduce((sum, item) => sum + item.lineTotalYen, 0);
      state = { items, goodsTotalYen, estimatedShippingYen: goodsTotalYen >= 10000 ? 0 : 940 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state, requestId: 't26-cart-put' }) });
      return;
    }
    if (method === 'DELETE') {
      const productId = new URL(route.request().url()).searchParams.get('productId');
      const items = state.items.filter((item) => item.productId !== productId);
      const goodsTotalYen = items.reduce((sum, item) => sum + item.lineTotalYen, 0);
      state = { items, goodsTotalYen, estimatedShippingYen: items.length === 0 ? 0 : goodsTotalYen >= 10000 ? 0 : 940 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state, requestId: 't26-cart-delete' }) });
      return;
    }
    await route.continue();
  });
}

const emptyCart: CartState = { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 };

test('anonymous cart adds an item, shows the live price and estimated total, and adapts to phone width', async ({ page }) => {
  setCartRoutes(page, emptyCart);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'カートは空です' })).toBeVisible();
  await expect(page.getByRole('link', { name: '商品を検索する' })).toHaveAttribute('href', '/search');

  await page.goto(`/cart?productId=${sampleProductId}&quantity=2`);
  await expect(page.getByRole('heading', { name: 'Fixture CPU' })).toBeVisible();
  await expect(page.getByText('追加時 ¥1,000 → 現在 ¥890。合計には現在価格を使用しています。')).toBeVisible();
  await expect(page.getByText('送料（概算）')).toBeVisible();
  await expect(page.getByText('税込合計見込み')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ログインして購入手続きへ' })).toHaveAttribute('href', '/login?next=%2Fcheckout%2Faddress');

  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.querySelector('main > div:last-of-type')!).gridTemplateColumns.split(' ').length)).toBe(2);

  await page.setViewportSize({ width: 375, height: 812 });
  const columns = await page.evaluate(() => getComputedStyle(document.querySelector('main > div:last-of-type')!).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('stock conflicts and unavailable items are shown per line and can be corrected or removed', async ({ page }) => {
  const stockItem: CartItem = { productId: sampleProductId, quantity: 2, unitPriceYen: 890, lineTotalYen: 1780,
    availableQuantity: 1, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
    unitPriceAtAddYen: 1000, availabilityState: 'available' };
  const endedItem: CartItem = { productId: '00000000-0000-4000-8000-000000000262', quantity: 1, unitPriceYen: 1200, lineTotalYen: 1200,
    availableQuantity: 0, name: 'Fixture Discontinued SSD', sku: 'SSD-262', unitPriceAtAddYen: null, availabilityState: 'unavailable' };
  setCartRoutes(page, { items: [stockItem, endedItem], goodsTotalYen: 2980, estimatedShippingYen: null });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cart');
  const stockRow = page.locator('article').filter({ hasText: 'Fixture CPU' });
  const endedRow = page.locator('article').filter({ hasText: 'Fixture Discontinued SSD' });
  await expect(stockRow.getByText('数量を確認してください')).toBeVisible();
  await expect(endedRow.getByText('販売終了')).toBeVisible();
  await expect(page.getByText('送料概算を表示できません')).toBeVisible();
  await expect(page.getByText('税込合計見込み')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ログインして購入手続きへ' })).toHaveAttribute('aria-disabled', 'true');

  await stockRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(stockRow.getByRole('alert')).toContainText('販売可能数が更新されました');
  await stockRow.getByLabel('数量（1〜10）').fill('1');
  await stockRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(stockRow.getByText('販売可能数：1点')).toBeVisible();
  await stockRow.getByRole('button', { name: '削除' }).click();
  await endedRow.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('heading', { name: 'カートは空です' })).toBeVisible();
});

test('signed-in member cart links directly to checkout', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36_MEMBER_EMAIL and T36_MEMBER_PASSWORD must identify a locally provisioned regular account');
  setCartRoutes(page, emptyCart);
  await page.goto('/login?next=%2Fcart');
  await page.getByLabel('メールアドレス').fill(process.env.T36_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/cart');
  await page.goto(`/cart?productId=${sampleProductId}&quantity=1`);
  await expect(page.getByRole('link', { name: '購入手続きへ' })).toHaveAttribute('href', '/checkout/address');
});