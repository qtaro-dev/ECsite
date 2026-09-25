import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email: string, password: string, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(destination);
}

test('administrator can review versioned shipping settings and receive actionable missing-rate feedback', async ({ page }) => {
  test.skip(!process.env.T36_ADMIN_EMAIL || !process.env.T36_ADMIN_PASSWORD,
    'T36 local admin fixture is required');
  await signIn(page, process.env.T36_ADMIN_EMAIL!, process.env.T36_ADMIN_PASSWORD!, '/admin/settings/shipping');
  await expect(page.getByRole('heading', { name: /送料設定/ })).toBeVisible();
  await expect(page.getByText(/設定履歴/)).toBeVisible();
  const oldVersion = await page.locator('section[aria-label="現在有効な送料規則"] strong').textContent();
  const fee = page.getByLabel('全国一律の通常送料（税込・円）');
  await fee.fill(String(Number(await fee.inputValue()) + 1));
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で保存' }).click();
  await expect(page.getByText(/新しい送料規則版を保存しました/)).toBeVisible();
  await expect(page.locator('section[aria-label="現在有効な送料規則"] strong')).not.toHaveText(oldVersion ?? '');
  await expect(page.getByText(/監査ID:/)).toBeVisible();
  await page.getByRole('button', { name: '入力した規則で試算' }).click();
  const guidance = page.locator('main p[role="alert"]');
  await expect(guidance).toContainText('重量物運賃表を読み取れません');
  await expect(guidance).toContainText('運賃表を確認して保存してください');
  await page.getByRole('button', { name: '運賃行を追加' }).click();
  await page.getByLabel('公式情報の確認日').fill('2026-09-25');
  await page.getByRole('button', { name: '入力した規則で試算' }).click();
  await expect(guidance).toContainText('運賃行がありません');
  await expect(guidance).toContainText('該当する行を追加してください');
  const response = await page.request.get('/api/admin/settings/shipping');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ data: { active: { version: expect.any(String) }, history: expect.any(Array), auditId: expect.any(String) } });
});

test('regular member cannot read shipping admin settings', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36 local member fixture is required');
  await signIn(page, process.env.T36_MEMBER_EMAIL!, process.env.T36_MEMBER_PASSWORD!, '/account');
  const response = await page.request.get('/api/admin/settings/shipping');
  expect(response.status()).toBe(403);
});
