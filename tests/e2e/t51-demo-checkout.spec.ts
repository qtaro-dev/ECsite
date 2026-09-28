import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const origin = 'http://127.0.0.1:4173';

async function startDemo(page: Page) {
  await page.goto('/login?next=%2Fcart');
  await page.getByRole('button', { name: 'デモを開始・再開' }).click();
  await expect(page).toHaveURL('/cart');
}

test('two demo browsers use owned fictional addresses and quotes without free-form personal details', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Local Supabase anonymous Auth credentials are required');
  const first = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const second = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 800 } });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    const catalog = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: product, error } = await catalog.from('products').select('id').eq('slug', 't11-cpu-am5').single();
    expect(error).toBeNull();
    expect(product?.id).toBeTruthy();
    await startDemo(a);
    await startDemo(b);
    for (const page of [a, b]) {
      const added = await page.request.put('/api/cart', { headers: { origin }, data: { productId: product!.id, quantity: 1 } });
      expect(added.status()).toBe(200);
      await page.goto('/checkout/address');
      await expect(page.getByText('氏名、実住所、電話番号、メールアドレスを入力しないでください。')).toBeVisible();
      await expect(page.getByLabel('お名前')).toHaveCount(0);
      await expect(page.getByLabel('郵便番号（ハイフンなし）')).toHaveCount(0);
      await expect(page.getByLabel('送料を試す地域')).toBeVisible();
      for (const width of [320, 640, 767, 768, 1199, 1200]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth),
          `demo address page should not overflow at ${width}px CSS width`).toBeLessThanOrEqual(width);
      }
    }
    await a.getByLabel('送料を試す地域').selectOption('13');
    await b.getByLabel('送料を試す地域').selectOption('1');
    const quote = async (page: Page) => {
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/checkout/quote') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '架空配送先で正式見積へ' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      await expect(page).toHaveURL('/checkout/review');
      await expect(page.getByText('実カード番号を入力しないでください。')).toBeVisible();
      return (await response.json()).data as { quoteId: string; address: { id: string; recipientName: string; postalCode: string; prefectureCode: number } };
    };
    const [aQuote, bQuote] = await Promise.all([quote(a), quote(b)]);
    expect(aQuote.address.id).not.toBe(bQuote.address.id);
    expect(aQuote.quoteId).not.toBe(bQuote.quoteId);
    expect(aQuote.address).toMatchObject({ recipientName: 'デモ購入者', postalCode: '0000000', prefectureCode: 13 });
    expect(bQuote.address).toMatchObject({ recipientName: 'デモ購入者', postalCode: '0000000', prefectureCode: 1 });
    const crossed = await b.request.post('/api/checkout/quote', { headers: { origin }, data: { addressId: aQuote.address.id } });
    expect(crossed.status()).toBe(404);

    for (const page of [a, b]) {
      for (const width of [320, 640, 767, 768, 1199, 1200]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth),
          `demo checkout review should not overflow at ${width}px CSS width`).toBeLessThanOrEqual(width);
      }
    }
    await b.setViewportSize({ width: 320, height: 800 });
    expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    await first.close();
    await second.close();
  }
});
