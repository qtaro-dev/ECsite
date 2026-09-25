import { expect, test } from '@playwright/test';

test('login and registration offer Google OAuth with a same-site return path', async ({ page }) => {
  await page.goto('/login?next=%2Fcheckout%2Faddress');
  const loginLink = page.getByRole('link', { name: 'Googleでログイン・登録' });
  await expect(loginLink).toHaveAttribute('href', '/api/auth/google?next=%2Fcheckout%2Faddress');

  await page.goto('/register?next=%2Fcheckout%2Faddress');
  const registerLink = page.getByRole('link', { name: 'Googleで登録・ログイン' });
  await expect(registerLink).toHaveAttribute('href', '/api/auth/google?next=%2Fcheckout%2Faddress');
});

test('Google OAuth errors show a recoverable message on login', async ({ page }) => {
  await page.goto('/login?error=google');
  await expect(page.getByRole('alert')).toHaveText('Googleログインを完了できませんでした。もう一度お試しください。');
});
