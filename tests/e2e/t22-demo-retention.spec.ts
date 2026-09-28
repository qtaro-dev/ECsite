import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

test('one demo member can delete own Auth and address without deleting another viewer', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Local Supabase Auth and service-role credentials are required');
  const first = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 800 } });
  const second = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    for (const page of [a, b]) {
      await page.goto('/login?next=%2Faccount');
      await page.getByRole('button', { name: 'デモを開始・再開' }).click();
      await expect(page).toHaveURL('/account');
      const created = await page.request.post('/api/checkout/demo-address', { headers: { origin }, data: { prefectureCode: 13 } });
      expect(created.status()).toBe(201);
    }
    const bBefore = await b.request.get('/api/account/addresses');
    expect((await bBefore.json()).data).toHaveLength(1);
    await a.getByLabel('確認のため「アカウントを削除」と入力してください').fill('アカウントを削除');
    const deleted = a.waitForResponse((response) => response.url().endsWith('/api/account/delete') && response.request().method() === 'POST');
    await a.getByRole('button', { name: 'デモ会員を削除する' }).click();
    const response = await deleted;
    expect(response.status()).toBe(200);
    await expect(a).toHaveURL('/');
    expect((await a.request.get('/api/account/addresses')).status()).toBe(401);
    expect((await b.request.get('/api/account/addresses')).status()).toBe(200);
    await b.reload();
    await expect(b.getByText('デモ会員として利用中です。')).toBeVisible();
    expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    await first.close();
    await second.close();
  }
});
