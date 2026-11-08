import { expect, test, type Page } from '@playwright/test';

type CartItem = {
  productId: string;
  quantity: number;
  unitPriceYen: number | null;
  lineTotalYen: number | null;
  availableQuantity: number;
  name: string | null;
  slug: string | null;
  brand: string | null;
  sku: string | null;
  imagePath: string | null;
  unitPriceAtAddYen: number | null;
  availabilityState: 'available' | 'sold_out' | 'unavailable';
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
        imagePath: null, unitPriceAtAddYen: 890, availabilityState: 'available' as const };
      if (body.quantity > template.availableQuantity) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', currentCart: state }, requestId: 't26-cart-conflict' }) });
        return;
      }
      const items = state.items.filter((item) => item.productId !== body.productId);
      const updated: CartItem = { ...template, quantity: body.quantity, lineTotalYen: template.unitPriceYen === null ? null : template.unitPriceYen * body.quantity };
      items.push(updated);
      const goodsTotalYen = items.reduce((sum, item) => sum + (item.lineTotalYen ?? 0), 0);
      state = { items, goodsTotalYen, estimatedShippingYen: goodsTotalYen >= 10000 ? 0 : 940 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state, requestId: 't26-cart-put' }) });
      return;
    }
    if (method === 'DELETE') {
      const productId = new URL(route.request().url()).searchParams.get('productId');
      const items = state.items.filter((item) => item.productId !== productId);
      const goodsTotalYen = items.reduce((sum, item) => sum + (item.lineTotalYen ?? 0), 0);
      state = { items, goodsTotalYen, estimatedShippingYen: items.length === 0 ? 0 : goodsTotalYen >= 10000 ? 0 : 940 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state, requestId: 't26-cart-delete' }) });
      return;
    }
    await route.continue();
  });
}

const emptyCart: CartState = { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 };

test('anonymous cart adds an item, shows current and reference prices, and adapts to phone width', async ({ page }) => {
  setCartRoutes(page, emptyCart);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'カートは空です' })).toBeVisible();
  await expect(page.getByRole('link', { name: '商品を検索する' })).toHaveAttribute('href', '/search');

  await page.goto(`/cart?productId=${sampleProductId}&quantity=2`);
  await expect(page.getByRole('heading', { name: 'Fixture CPU' })).toBeVisible();
  await expect(page.getByText('追加時の価格と比較できません。現在価格をご確認ください。')).toHaveCount(0);
  await expect(page.getByText('追加時 ¥890 → 現在 ¥890。合計には現在価格を使用しています。')).toHaveCount(0);
  await expect(page.getByText('送料（概算）')).toBeVisible();
  await expect(page.getByText('税込合計見込み')).toBeVisible();
  const checkout = page.getByRole('link', { name: 'デモ会員を開始して購入手続きへ' });
  await expect(checkout).toHaveAttribute('href', '/login?next=%2Fcheckout%2Faddress');
  await expect(checkout).toHaveCSS('color', 'rgb(255, 255, 255)');
  await checkout.hover();
  await expect(checkout).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(checkout).toHaveCSS('background-color', 'rgb(0, 78, 235)');
  await page.mouse.move(0, 0);
  await checkout.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(checkout).toBeFocused();
  await expect(checkout).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(checkout).not.toHaveCSS('box-shadow', 'none');

  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.querySelector('main > div:last-of-type')!).gridTemplateColumns.split(' ').length)).toBe(2);

  const changedItem: CartItem = { productId: sampleProductId, quantity: 2, unitPriceYen: 890, lineTotalYen: 1780,
    availableQuantity: 5, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
    imagePath: null, unitPriceAtAddYen: 1000, availabilityState: 'available' };
  setCartRoutes(page, { items: [changedItem], goodsTotalYen: 1780, estimatedShippingYen: 940 });
  await page.goto('/cart');
  await expect(page.getByText('追加時 ¥1,000 → 現在 ¥890。合計には現在価格を使用しています。')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  const columns = await page.evaluate(() => getComputedStyle(document.querySelector('main > div:last-of-type')!).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('cart uses the product image first and falls back to its category illustration when unavailable', async ({ page }) => {
  const item: CartItem = { productId: sampleProductId, quantity: 1, unitPriceYen: 890, lineTotalYen: 890,
    availableQuantity: 5, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
    imagePath: 'test/cpu-unavailable.png', unitPriceAtAddYen: 890, availabilityState: 'available' };
  setCartRoutes(page, { items: [item], goodsTotalYen: 890, estimatedShippingYen: 940 });
  await page.route('**/api/catalog/image-categories**', (route) => route.fulfill({ json: { data: { [sampleProductId]: 'cpu' } } }));
  await page.route('**/api/product-images/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('/cart');
  const imageLink = page.getByRole('link', { name: 'Fixture CPUの商品詳細' });
  await expect(imageLink.locator('img')).toHaveAttribute('src', '/images/home-category/01_cpu.png');
  await expect(imageLink.getByText('カテゴリのイメージ')).toBeVisible();
});

test('stock conflicts and unavailable items are shown per line and can be corrected or removed', async ({ page }) => {
  const stockItem: CartItem = { productId: sampleProductId, quantity: 2, unitPriceYen: 890, lineTotalYen: 1780,
    availableQuantity: 1, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
    imagePath: null, unitPriceAtAddYen: 1000, availabilityState: 'available' };
  const endedItem: CartItem = { productId: '00000000-0000-4000-8000-000000000262', quantity: 1, unitPriceYen: null, lineTotalYen: null,
    availableQuantity: 0, name: '販売終了した商品', slug: null, brand: null, sku: null, imagePath: null,
    unitPriceAtAddYen: null, availabilityState: 'unavailable' };
  setCartRoutes(page, { items: [stockItem, endedItem], goodsTotalYen: 1780, estimatedShippingYen: null });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cart');
  const stockRow = page.locator('article').filter({ hasText: 'Fixture CPU' });
  const endedRow = page.locator('article').filter({ hasText: '販売終了した商品' });
  await expect(stockRow.getByText('数量を確認してください')).toBeVisible();
  await expect(endedRow.getByText('販売終了', { exact: true })).toBeVisible();
  await expect(page.getByText('送料概算を表示できません')).toBeVisible();
  await expect(page.getByText('税込合計見込み')).toHaveCount(0);
  const disabledCheckout = page.getByRole('link', { name: 'デモ会員を開始して購入手続きへ' });
  await expect(disabledCheckout).toHaveAttribute('aria-disabled', 'true');
  await disabledCheckout.hover({ force: true });
  await expect(disabledCheckout).toHaveCSS('color', 'rgb(80, 91, 109)');
  await expect(disabledCheckout).toHaveCSS('background-color', 'rgb(229, 232, 239)');

  await stockRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(stockRow.getByRole('alert')).toContainText('販売可能数が更新されました');
  await stockRow.getByLabel('数量（1〜10）').fill('1');
  await stockRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(stockRow.getByText('販売可能数：1点')).toBeVisible();
  await stockRow.getByRole('button', { name: '削除' }).click();
  await endedRow.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('heading', { name: 'カートは空です' })).toBeVisible();
});

test('failed query-string add remains retryable', async ({ page }) => {
  let putCount = 0;
  page.route('**/api/cart**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: emptyCart }) });
      return;
    }
    if (route.request().method() === 'PUT') {
      putCount += 1;
      if (putCount === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
      } else {
        const item: CartItem = { productId: sampleProductId, quantity: 1, unitPriceYen: 890, lineTotalYen: 890,
          availableQuantity: 5, name: 'Fixture CPU', slug: 'fixture-cpu', brand: 'Fixture Works', sku: 'CPU-261',
          imagePath: null, unitPriceAtAddYen: 890, availabilityState: 'available' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { items: [item], goodsTotalYen: 890, estimatedShippingYen: 940 } }) });
      }
      return;
    }
    await route.continue();
  });
  await page.goto(`/cart?productId=${sampleProductId}`);
  await expect(page.getByRole('button', { name: '商品を再度カートに追加' })).toBeVisible();
  await page.getByRole('button', { name: '商品を再度カートに追加' }).click();
  await expect(page.getByRole('heading', { name: 'Fixture CPU' })).toBeVisible();
  expect(putCount).toBe(2);
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

test('cart header sums item quantities, caps the visible badge and stays in sync on desktop and mobile', async ({ page }) => {
  setCartRoutes(page, emptyCart);
  await page.setViewportSize({ width: 1280, height: 900 });
  const link = page.locator('header a[href="/cart"]');
  const badge = link.locator('[aria-hidden="true"]');

  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'カートは空です' })).toBeVisible();
  await expect(link).toHaveAccessibleName('カート');
  await expect(badge).toHaveCount(0);

  await page.goto('/cart?productId=' + sampleProductId + '&quantity=1');
  await expect(link).toHaveAccessibleName('カート（商品1点）');
  await expect(badge).toHaveText('1');
  const firstRow = page.locator('article').filter({ has: page.locator('[id="cart-item-' + sampleProductId + '"]') });
  await firstRow.getByLabel('数量（1〜10）').fill('5');
  await firstRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(badge).toHaveText('5');

  const otherId = '00000000-0000-4000-8000-000000000265';
  await page.goto('/cart?productId=' + otherId + '&quantity=4');
  await expect(badge).toHaveText('9');
  const secondRow = page.locator('article').filter({ has: page.locator('[id="cart-item-' + otherId + '"]') });
  await secondRow.getByLabel('数量（1〜10）').fill('5');
  await secondRow.getByRole('button', { name: '数量を更新' }).click();
  await expect(link).toHaveAccessibleName('カート（商品10点）');
  await expect(badge).toHaveText('9+');

  await page.setViewportSize({ width: 320, height: 812 });
  await page.locator('header a[href="/"]').click();
  await expect(page).toHaveURL('/');
  await expect(badge).toHaveText('9+');
  await page.reload();
  await expect(link).toHaveAccessibleName('カート（商品10点）');
  await expect(badge).toHaveText('9+');
  const corner = await badge.boundingBox();
  const button = await link.boundingBox();
  expect(corner && button && corner.x > button.x + button.width / 2 && corner.y < button.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await link.click();
  await firstRow.getByRole('button', { name: '削除' }).click();
  await expect(badge).toHaveText('5');
  await secondRow.getByRole('button', { name: '削除' }).click();
  await expect(link).toHaveAccessibleName('カート');
  await expect(badge).toHaveCount(0);
});
