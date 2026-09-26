import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  test.skip(!process.env.T28_MEMBER_EMAIL || !process.env.T28_MEMBER_PASSWORD,
    'CI must provision the isolated T28 member account');
  await page.goto('/login?next=%2Fcart');
  await page.getByLabel('メールアドレス').fill(process.env.T28_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T28_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/cart');
}

test('member can create and review a 15-minute formal quote with current shipping and tax', async ({ page }) => {
  await signIn(page);
  const baseUrl = 'http://127.0.0.1:4173';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Local Supabase public credentials are required');
  const productLookup = new URL('/rest/v1/products', supabaseUrl);
  productLookup.searchParams.set('select', 'id,slug');
  productLookup.searchParams.set('slug', 'in.(t11-cpu-am5,t11-motherboard-atx)');
  const productResponse = await fetch(productLookup, { headers: { apikey: publishableKey } });
  expect(productResponse.status).toBe(200);
  const fixtureProducts = await productResponse.json() as Array<{ id: string; slug: string }>;
  expect(fixtureProducts).toHaveLength(2);
  const productIds = Object.fromEntries(fixtureProducts.map((product) => [product.slug, product.id]));
  const oldCart = await page.request.get(`${baseUrl}/api/cart`);
  expect(oldCart.status()).toBe(200);
  for (const item of (await oldCart.json()).data.items as Array<{ productId: string }>) {
    const removed = await page.request.delete(`${baseUrl}/api/cart?productId=${item.productId}`, { headers: { origin: baseUrl } });
    expect(removed.status()).toBe(200);
  }
  for (const productId of Object.values(productIds)) {
    const added = await page.request.put(`${baseUrl}/api/cart`, {
      headers: { origin: baseUrl }, data: { productId, quantity: 1 },
    });
    expect(added.status()).toBe(200);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/checkout/address');
  await expect(page.getByRole('heading', { name: 'お届け先を選択' })).toBeVisible();
  const addNew = page.getByLabel('新しい配送先を登録する');
  if (await addNew.count()) await addNew.check();
  await page.getByLabel('お名前').fill('T28 合成テスト受取人');
  await page.getByLabel('郵便番号（ハイフンなし）').fill('1000001');
  await page.getByLabel('都道府県').selectOption('13');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByLabel('番地').fill('千代田1-1');
  const quoteResponse = page.waitForResponse((response) => response.url().includes('/api/checkout/quote') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '住所を確認して正式見積へ' }).click();
  const response = await quoteResponse;
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.expiresAt).toBeTruthy();
  expect(Date.parse(data.expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
  expect(Date.parse(data.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  expect(data.address.recipientName).toBe('T28 合成テスト受取人');
  expect(data.items.find((item: { name: string }) => item.name === 'T11 Test CPU AM5')).toMatchObject({ unitPriceYen: 9999, unitPriceAtAddYen: 9999 });
  expect(data.shipping).toEqual({ baseYen: 0, heavyYen: 0, totalYen: 0 });
  expect(data.grandTotalYen).toBe(17998);
  expect(data.taxTotalYen).toBe(1636);
  expect(JSON.stringify(data)).not.toContain('addressId');
  await expect(page).toHaveURL('/checkout/review');
  await expect(page.getByRole('heading', { name: '注文内容の確認' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '正式な金額' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('review shows price changes and compatibility warnings while requiring explicit amount confirmation', async ({ page }) => {
  const quote = {
    quoteId: '00000000-0000-4000-8000-000000000028', expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    address: { id: '00000000-0000-4000-8000-000000000029', recipientName: '受取人', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '1-1', building: null, isDefault: true },
    items: [{ productId: '00000000-0000-4000-8000-000000000030', sku: 'CPU-30', name: 'Fixture CPU', brand: 'Fixture Works', category: 'cpu', quantity: 1, unitPriceYen: 10000, lineTotalYen: 10000, availableQuantity: 5, taxRateBasisPoints: 1000, unitPriceAtAddYen: 9000 }],
    priceChanges: [{ productId: '00000000-0000-4000-8000-000000000030', name: 'Fixture CPU', unitPriceAtAddYen: 9000, unitPriceYen: 10000 }],
    goodsTotalYen: 10000, shipping: { baseYen: 0, heavyYen: 2500, totalYen: 2500 }, taxTotalYen: 1136, grandTotalYen: 12500,
    shippingSettingsVersion: 'e2e-v1', shippingSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html', shippingSourceCheckedAt: null,
    compatibility: [
      { rule: 'cpu_motherboard_socket', status: 'incompatible', reason: 'CPUとマザーボードのSocketが一致しません。', comparedValues: { cpuSocketCode: 'AM4', motherboardSocketCode: 'AM5' }, matchingUrl: '/search?category=motherboard' },
      { rule: 'motherboard_memory_ddr', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'motherboard_case_form_factor', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'gpu_case_length', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'cpu_cooler_socket', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
    ],
  };
  await page.addInitScript((storedQuote) => window.sessionStorage.setItem('checkoutQuote', JSON.stringify(storedQuote)), quote);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/checkout/review');
  await expect(page.getByRole('listitem').filter({ hasText: 'Fixture CPU: 9,000円 → 10,000円' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'カート表示後に価格が変わりました' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '構成の互換性について' })).toBeVisible();
  await expect(page.getByText('警告のみで、購入は妨げません。')).toBeVisible();
  const checkout = page.getByRole('button', { name: '内容を確認してテスト決済へ' });
  await expect(checkout).toBeDisabled();
  await page.getByLabel('商品・配送先・正式な金額を確認しました。').check();
  await expect(checkout).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
