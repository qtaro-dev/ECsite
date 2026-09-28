import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const origin = 'http://127.0.0.1:4173';

async function startDemo(page: Page) {
  await page.goto('/login?next=%2Fcart');
  await page.getByRole('button', { name: 'デモを開始・再開' }).click();
  await expect(page).toHaveURL('/cart');
}

async function createQuote(page: Page, prefectureCode: string) {
  await page.goto('/checkout/address');
  await page.getByLabel('送料を試す地域').selectOption(prefectureCode);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/checkout/quote') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '架空配送先で正式見積へ' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL('/checkout/review');
  return (await response.json()).data as { quoteId: string; address: { id: string; prefectureCode: number } };
}

test('demo buyers keep checkout quotes isolated and handle mocked Stripe success and stock failure', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Local Supabase anonymous Auth credentials are required');
  const firstContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const secondContext = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 800 } });
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const catalog = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: product, error } = await catalog.from('products').select('id').eq('slug', 't11-cpu-am5').single();
    expect(error).toBeNull();
    expect(product?.id).toBeTruthy();

    await Promise.all([startDemo(first), startDemo(second)]);
    for (const page of [first, second]) {
      const added = await page.request.put('/api/cart', { headers: { origin }, data: { productId: product!.id, quantity: 1 } });
      expect(added.status()).toBe(200);
    }
    const [firstQuote, secondQuote] = await Promise.all([
      createQuote(first, '13'), createQuote(second, '14'),
    ]);
    expect(firstQuote.quoteId).not.toBe(secondQuote.quoteId);
    expect(firstQuote.address.id).not.toBe(secondQuote.address.id);
    expect(firstQuote.address.prefectureCode).toBe(13);
    expect(secondQuote.address.prefectureCode).toBe(14);
    const crossed = await second.request.post('/api/checkout/quote', {
      headers: { origin }, data: { addressId: firstQuote.address.id },
    });
    expect(crossed.status()).toBe(404);

    let firstStart: { quoteId: string; userConfirmed: boolean } | undefined;
    await first.route('**/api/checkout/start', async (route) => {
      firstStart = route.request().postDataJSON() as typeof firstStart;
      await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: '在庫が不足しています。カートの数量を見直してください。' } } });
    });
    await first.getByLabel('商品・配送先・正式な金額を確認しました。').check();
    await first.getByRole('button', { name: '内容を確認してテスト決済へ' }).click();
    await expect(first.getByText('在庫が不足しています。カートの数量を見直してください。', { exact: true })).toBeVisible();
    expect(firstStart).toMatchObject({ quoteId: firstQuote.quoteId, userConfirmed: true });

    let secondStart: { quoteId: string; userConfirmed: boolean } | undefined;
    await second.route('**/api/checkout/start', async (route) => {
      secondStart = route.request().postDataJSON() as typeof secondStart;
      await route.fulfill({ json: { data: { orderId: '00000000-0000-4000-8000-000000000035', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_t35_mock' } } });
    });
    await second.route('https://checkout.stripe.com/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<main><h1>Mock Stripe test checkout</h1></main>',
    }));
    await second.getByLabel('商品・配送先・正式な金額を確認しました。').check();
    await second.getByRole('button', { name: '内容を確認してテスト決済へ' }).click();
    await expect(second).toHaveURL('https://checkout.stripe.com/c/pay/cs_test_t35_mock');
    await expect(second.getByRole('heading', { name: 'Mock Stripe test checkout' })).toBeVisible();
    expect(secondStart).toMatchObject({ quoteId: secondQuote.quoteId, userConfirmed: true });
    expect(await second.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
