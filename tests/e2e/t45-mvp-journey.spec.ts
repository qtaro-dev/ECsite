import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

async function startDemo(page: Page) {
  await page.goto('/login?next=%2F');
  const signup = page.waitForResponse((response) =>
    response.url().includes('/auth/v1/signup') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'デモを開始・再開' }).click();
  const response = await signup;
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { user?: { id?: string } };
  expect(payload.user?.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(origin + '/');
  return payload.user!.id!;
}

async function discoverAddAndQuote(page: Page, query: string, prefecture: string) {
  await page.goto('/');
  await page.getByLabel('商品名・型番で検索').fill(query);
  await page.getByRole('button', { name: '商品を検索' }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  const productLink = page.getByRole('link', { name: /商品詳細$/ }).first();
  await expect(productLink).toBeVisible();
  const productName = (await productLink.getAttribute('aria-label'))!.replace(/の商品詳細$/, '');
  await productLink.click();
  await expect(page.getByRole('heading', { level: 1, name: productName })).toBeVisible();
  await page.getByRole('link', { name: 'カートへ進む' }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await page.goto('/checkout/address');
  await page.getByLabel('送料を試す地域').selectOption(prefecture);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/checkout/quote') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '架空配送先で正式見積へ' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL('/checkout/review');
  await expect(page.getByRole('heading', { name: '注文内容の確認' })).toBeVisible();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await page.getByLabel('商品・配送先・正式な金額を確認しました。').check();
  await expect(page.getByRole('button', { name: '内容を確認してテスト決済へ' })).toBeEnabled();
  const data = (await response.json()).data as { quoteId: string; address: { id: string; prefectureCode: number }; grandTotalYen: number };
  expect(data.quoteId).toMatch(/^[0-9a-f-]{36}$/);
  expect(data.grandTotalYen).toBeGreaterThan(0);
  return data;
}

test('two demo members discover a product, reach formal quote, and cannot read the other quote', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Local Supabase anonymous Auth credentials are required');
  const firstContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const secondContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const [firstId, secondId] = await Promise.all([startDemo(first), startDemo(second)]);
    expect(firstId).not.toBe(secondId);

    const [firstQuote, secondQuote] = await Promise.all([
      discoverAddAndQuote(first, 'T11 Test CPU AM5', '13'),
      discoverAddAndQuote(second, 'T11 Test CPU AM5', '14'),
    ]);
    expect(firstQuote.quoteId).not.toBe(secondQuote.quoteId);
    expect(firstQuote.address.id).not.toBe(secondQuote.address.id);
    expect(firstQuote.address.prefectureCode).toBe(13);
    expect(secondQuote.address.prefectureCode).toBe(14);

    const crossed = await second.request.post('/api/checkout/quote', {
      headers: { origin }, data: { addressId: firstQuote.address.id },
    });
    expect(crossed.status()).toBe(404);
    await expect(second.getByRole('heading', { name: '注文内容の確認' })).toBeVisible();
    await expect(second.getByText('お支払い合計')).toBeVisible();
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
