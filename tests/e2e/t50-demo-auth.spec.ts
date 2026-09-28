import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test('two browsers create isolated Supabase demo users, reuse sessions, and can end them', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Local Supabase anonymous Auth credentials are required');
  const first = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 375, height: 812 } });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    const catalog = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: product, error: productError } = await catalog.from('products').select('id').eq('slug', 't11-cpu-am5').single();
    expect(productError).toBeNull();
    expect(product?.id).toBeTruthy();
    const before = await a.request.put('/api/cart', {
      headers: { origin: 'http://127.0.0.1:4173' }, data: { productId: product!.id, quantity: 1 },
    });
    expect(before.ok()).toBe(true);
    const start = async (page: typeof a) => {
      await page.goto('/login?next=%2Faccount');
      const signup = page.waitForResponse((response) => response.url().includes('/auth/v1/signup') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'デモを開始・再開' }).click();
      const response = await signup;
      expect(response.ok()).toBe(true);
      const payload = await response.json() as { user?: { id?: string } };
      expect(payload.user?.id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByText('デモ会員として利用中です。')).toBeVisible();
      return payload.user!.id!;
    };
    const aId = await start(a);
    const bId = await start(b);
    expect(aId).not.toBe(bId);
    const aCart = await (await a.request.get('/api/cart')).json() as { data: { items: Array<{ productId: string }> } };
    const bCart = await (await b.request.get('/api/cart')).json() as { data: { items: Array<{ productId: string }> } };
    expect(aCart.data.items.map((item) => item.productId)).toContain(product!.id);
    expect(bCart.data.items).toEqual([]);

    let extraSignups = 0;
    a.on('response', (response) => { if (response.url().includes('/auth/v1/signup')) extraSignups += 1; });
    await a.goto('/login?next=%2Faccount');
    await a.getByRole('button', { name: 'デモを開始・再開' }).click();
    await expect(a).toHaveURL(/\/account$/);
    expect(extraSignups).toBe(0);

    await a.getByRole('button', { name: 'デモを終了' }).click();
    await expect(a).toHaveURL('/');
    await a.goto('/account');
    await expect(a).toHaveURL(/\/login\?next=/);
    await b.reload();
    await expect(b.getByText('デモ会員として利用中です。')).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
