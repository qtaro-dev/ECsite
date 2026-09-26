import { expect, test } from '@playwright/test';
import type { ProductSearchItem } from '@/server/catalog/product-search';

test('S05 checks compatible, incompatible, and unknown parts; selections survive sharing, history, and mobile view', async ({ page }) => {
  const cartAdds: Array<{ productId: string; quantity: number }> = [];
  const cpuAm5: ProductSearchItem = { id: '00000000-0000-4000-8000-000000000241', slug: 'fixture-cpu-am5', sku: 'CPU-AM5', name: 'Fixture CPU AM5', brand: 'Fixture Works', category: 'cpu', description: 'Synthetic', beginnerNote: 'Synthetic', priceYen: 9999, images: [], useCases: [], specifications: { socket_code: 'AM5' } };
  const cpuAm4: ProductSearchItem = { ...cpuAm5, id: '00000000-0000-4000-8000-000000000242', slug: 'fixture-cpu-am4', sku: 'CPU-AM4', name: 'Fixture CPU AM4', specifications: { socket_code: 'AM4' } };
  const cpuUnknown: ProductSearchItem = { ...cpuAm5, id: '00000000-0000-4000-8000-000000000243', slug: 'fixture-cpu-unknown', sku: 'CPU-UNKNOWN', name: 'Fixture CPU Unknown', specifications: {} };
  const motherboard: ProductSearchItem = { ...cpuAm5, id: '00000000-0000-4000-8000-000000000244', slug: 'fixture-motherboard-am5', sku: 'MB-AM5', name: 'Fixture AM5 Motherboard', category: 'motherboard', specifications: { socket_code: 'AM5', ddr_generation: 'DDR5', form_factor: 'ATX' } };
  const catalog: Record<string, ProductSearchItem[]> = { cpu: [cpuAm5, cpuAm4, cpuUnknown], motherboard: [motherboard] };
  await page.route('**/api/products**', async (route) => {
    const url = new URL(route.request().url());
    const items = catalog[url.searchParams.get('category') ?? ''] ?? [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { items, total: items.length, page: 1, pageSize: 24 }, requestId: 't24-products' }) });
  });
  await page.route('**/api/compatibility', async (route) => {
    const body = route.request().postDataJSON() as { products: Array<{ category: string; productId: string }> };
    const cpuProduct = body.products.find((product) => product.category === 'cpu');
    const boardProduct = body.products.find((product) => product.category === 'motherboard');
    const socketFinding = !cpuProduct || !boardProduct
      ? { rule: 'cpu_motherboard_socket', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null }
      : cpuProduct.productId === cpuAm5.id
        ? { rule: 'cpu_motherboard_socket', status: 'compatible', reason: 'CPUとマザーボードのSocketが一致しています。', comparedValues: { cpuSocketCode: 'AM5', motherboardSocketCode: 'AM5' }, matchingUrl: null }
        : cpuProduct.productId === cpuAm4.id
          ? { rule: 'cpu_motherboard_socket', status: 'incompatible', reason: 'CPUとマザーボードのSocketが一致しません。', comparedValues: { cpuSocketCode: 'AM4', motherboardSocketCode: 'AM5' }, matchingUrl: '/search?category=motherboard&spec=%7B%22socket_code%22%3A%22AM4%22%7D' }
          : { rule: 'cpu_motherboard_socket', status: 'unknown', reason: '比較に必要な仕様が不足しているため判定できません。', comparedValues: { cpuSocketCode: null, motherboardSocketCode: 'AM5' }, matchingUrl: null };
    const data = [socketFinding,
      { rule: 'motherboard_memory_ddr', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'motherboard_case_form_factor', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'gpu_case_length', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
      { rule: 'cpu_cooler_socket', status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null },
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, requestId: 't24-compatibility' }) });
  });
  await page.route('**/api/cart', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    cartAdds.push(route.request().postDataJSON() as { productId: string; quantity: number });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { items: [], goodsTotalYen: 0, estimatedShippingYen: null }, requestId: 't24-cart' }) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/build');
  await expect(page.getByRole('heading', { name: 'パーツの構成を確認' })).toBeVisible();
  await expect(page.locator("section[aria-labelledby='parts-heading'] article")).toHaveCount(8);
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.querySelector("section[aria-labelledby='parts-heading'] > div:last-child")!).gridTemplateColumns.split(' ').length)).toBe(2);

  const cpu = page.locator("article[aria-labelledby='slot-cpu']");
  await page.locator('#product-select-cpu').selectOption({ label: 'Fixture CPU AM5（CPU-AM5）' });
  await expect(cpu.getByRole('link', { name: 'Fixture CPU AM5' })).toBeVisible();
  const addResponse = page.waitForResponse((response) => response.url().endsWith('/api/cart') && response.request().method() === 'PUT');
  await cpu.getByRole('button', { name: 'カートに追加' }).click();
  expect((await addResponse).status()).toBe(200);
  await expect(cpu.getByText('Fixture CPU AM5をカートに追加しました。')).toBeVisible();

  await page.locator('#product-select-motherboard').selectOption({ label: 'Fixture AM5 Motherboard（MB-AM5）' });
  const compatibility = page.locator("section[aria-labelledby='compatibility-heading']");
  await expect(compatibility.locator('article')).toHaveCount(5);
  await expect(compatibility.getByText('一致', { exact: true })).toBeVisible();
  await expect(compatibility.getByText('CPUのSocket', { exact: true })).toBeVisible();

  await page.locator('#product-select-cpu').selectOption({ label: 'Fixture CPU AM4（CPU-AM4）' });
  await expect(compatibility.getByText('CPUとマザーボードのSocketが一致しません。')).toBeVisible();
  await expect(compatibility.getByRole('link', { name: '条件に合う商品を探す' })).toHaveAttribute('href', /\/search\?category=motherboard&spec=/);
  await expect(cpu.getByRole('button', { name: 'カートに追加' })).toBeEnabled();
  await cpu.getByRole('button', { name: 'カートに追加' }).click();
  await expect(cpu.getByText('Fixture CPU AM4をカートに追加しました。')).toBeVisible();
  expect(cartAdds).toHaveLength(2);
  expect(cartAdds[1].productId).not.toBe(cartAdds[0].productId);

  await page.locator('#product-select-cpu').selectOption({ label: 'Fixture CPU Unknown（CPU-UNKNOWN）' });
  await expect(compatibility.getByText('判定できません', { exact: true })).toBeVisible();
  await expect(compatibility.getByText('比較に必要な仕様が不足しているため判定できません。')).toBeVisible();
  await expect(page).toHaveURL(/cpu=fixture-cpu-unknown/);
  await expect(page).toHaveURL(/motherboard=fixture-motherboard-am5/);

  await page.reload();
  await expect(page.locator("article[aria-labelledby='slot-cpu']").getByRole('link', { name: 'Fixture CPU Unknown' })).toBeVisible();
  await expect(page.locator("section[aria-labelledby='compatibility-heading']").getByText('判定できません', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/cpu=fixture-cpu-am4/);
  await expect(page.locator("article[aria-labelledby='slot-cpu']").getByRole('link', { name: 'Fixture CPU AM4' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: 'パーツを選ぶ' })).toBeVisible();
  const mobileColumns = await page.evaluate(() => getComputedStyle(document.querySelector("section[aria-labelledby='parts-heading'] > div:last-child")!).gridTemplateColumns.split(' ').length);
  expect(mobileColumns).toBe(1);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(375);
});
