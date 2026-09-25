import { expect, test } from '@playwright/test';

test('email registration, confirmation, login, and logout use separate SSR sessions', async ({ browser, page }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'Local Supabase credentials are required for the integrated auth flow');

  const email = `t17-${crypto.randomUUID()}@example.test`;
  const password = 'T17-Local-Test-Password-921!';
  await page.goto('/register?next=%2Fcart');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByLabel('パスワード（確認）').fill(password);
  await page.getByLabel('規約と個人情報の取り扱いを確認しました').check();
  await page.getByRole('button', { name: '確認メールを送る' }).click();
  await expect(page).toHaveURL(/\/verify\?email=/);
  await expect(page.getByText('登録メールが確認されるまで注文を開始できません。')).toBeVisible();

  await page.goto('/login?next=%2Faccount');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('alert')).toContainText('メールアドレスまたはパスワードを確認してください');

  const inboxBase = process.env.SUPABASE_INBUCKET_URL || 'http://127.0.0.1:54324';
  let confirmationUrl: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(`${inboxBase}/api/v1/messages`);
    if (!response.ok()) return false;
    const messages = await response.json() as { messages?: Array<{ ID?: string; To?: Array<{ Address?: string }> }> };
    const message = messages.messages?.find((item) => item.To?.some((to) => to.Address?.toLowerCase() === email.toLowerCase()));
    const contentResponse = message?.ID ? await page.request.get(`${inboxBase}/view/${message.ID}.txt`) : null;
    const content = contentResponse?.ok() ? await contentResponse.text() : '';
    const match = content.match(/https?:[^\s"<>]+/g)?.find((value) => value.includes('/auth/v1/verify'));
    if (match) confirmationUrl = match.replaceAll('&amp;', '&');
    return Boolean(confirmationUrl);
  }, { timeout: 20_000 }).toBe(true);
  await page.goto(confirmationUrl!);
  await expect(page).toHaveURL(/\/verify\?confirmed=1/);
  await expect(page.getByText('メールアドレスを確認しました。')).toBeVisible();

  const secondPage = await browser.newPage();
  await secondPage.goto('/account');
  await expect(secondPage).toHaveURL(/\/login\?next=/);
  await page.goto('/login?next=%2Faccount');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`ログイン中のメールアドレス: ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page).toHaveURL('/');
  await expect(secondPage).toHaveURL(/\/login\?next=/);
  await secondPage.close();
});
