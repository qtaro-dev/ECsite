import { expect, test } from '@playwright/test';

const orderId = '00000000-0000-4000-8000-000000000033';

test('Stripe success return stays pending until the database reports payment', async ({ page }) => {
  let status: 'payment_pending' | 'paid' = 'payment_pending';
  await page.route('**/api/checkout/status?orderId=*', async (route) => {
    await route.fulfill({ json: { data: { status, guidance: status === 'paid' ? 'テスト決済が完了しました。' : '決済通知を待っています。', retryEligible: false } } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/checkout/status?orderId=${orderId}&session_id=cs_test_return_is_not_proof`);
  await expect(page.getByRole('heading', { name: '決済結果' })).toBeVisible();
  await expect(page.getByText('決済結果を確認中です')).toBeVisible();
  await expect(page.getByText('テスト決済が完了しました')).toHaveCount(0);
  status = 'paid';
  await page.getByRole('button', { name: '最新の状態を確認' }).click();
  await expect(page.getByText('テスト決済が完了しました', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('failed, expired and review states show safe next actions', async ({ page }) => {
  let status = 'payment_failed';
  await page.route('**/api/checkout/status?orderId=*', async (route) => {
    await route.fulfill({ json: { data: { status, guidance: `状態: ${status}`, retryEligible: status !== 'review_required' } } });
  });
  await page.goto(`/checkout/result?orderId=${orderId}`);
  await expect(page.getByText('テスト決済を完了できませんでした')).toBeVisible();
  await expect(page.getByRole('link', { name: 'カートを確認して再見積する' })).toBeVisible();
  status = 'expired';
  await page.reload();
  await expect(page.getByText('決済の期限が切れました')).toBeVisible();
  status = 'review_required';
  await page.reload();
  await expect(page.getByText('決済状況を確認しています')).toBeVisible();
  await expect(page.getByRole('link', { name: 'カートを確認して再見積する' })).toHaveCount(0);
});

test('another member order returns a generic missing state without exposing details', async ({ page }) => {
  await page.route('**/api/checkout/status?orderId=*', async (route) => {
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '注文が見つかりません。' } } });
  });
  await page.goto(`/checkout/result?orderId=${orderId}`);
  await expect(page.getByText('注文が見つかりません', { exact: true })).toBeVisible();
  await expect(page.getByText('テスト決済が完了しました')).toHaveCount(0);
});
