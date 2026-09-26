import { expect, test } from '@playwright/test';

test('member can register, edit, and confirm deletion of a domestic address', async ({ page }) => {
  test.skip(!process.env.T36_MEMBER_EMAIL || !process.env.T36_MEMBER_PASSWORD,
    'T36_MEMBER_EMAIL and T36_MEMBER_PASSWORD must identify a locally provisioned regular account');
  await page.goto('/login?next=%2Faccount%2Faddresses');
  await page.getByLabel('メールアドレス').fill(process.env.T36_MEMBER_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.T36_MEMBER_PASSWORD!);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/account/addresses');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { name: '配送先の管理' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: '配送先の管理' })).toBeVisible();
  await page.getByLabel('お届け先の氏名').fill('T21 テスト会員');
  await page.getByLabel('郵便番号（ハイフンなし）').fill('1000001');
  await page.getByLabel('都道府県').selectOption('13');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByLabel('番地').fill('千代田1-1');
  await page.getByLabel('この住所を既定にする').check();
  await page.getByRole('button', { name: '保存する' }).click();
  const card = page.locator('article').filter({ hasText: 'T21 テスト会員' });
  await expect(card).toContainText('既定');

  await page.getByRole('button', { name: '新しい配送先' }).click();
  await page.getByLabel('お届け先の氏名').fill('T21 二件目');
  await page.getByLabel('郵便番号（ハイフンなし）').fill('1500001');
  await page.getByLabel('都道府県').selectOption('13');
  await page.getByLabel('市区町村').fill('渋谷区');
  await page.getByLabel('番地').fill('神宮前1-1');
  await page.getByLabel('この住所を既定にする').check();
  await page.getByRole('button', { name: '保存する' }).click();
  const secondCard = page.locator('article').filter({ hasText: 'T21 二件目' });
  await expect(secondCard).toContainText('既定');
  await expect(card).not.toContainText('既定');

  await secondCard.getByRole('button', { name: '編集' }).click();
  await page.getByLabel('お届け先の氏名').fill('T21 編集済み');
  await page.getByRole('button', { name: '保存する' }).click();
  const updatedCard = page.locator('article').filter({ hasText: 'T21 編集済み' });
  await expect(updatedCard).toBeVisible();
  await updatedCard.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('T21 編集済み');
  await page.getByRole('alertdialog').getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText('既定の配送先は設定されていません')).toBeVisible();
  await card.getByRole('button', { name: '削除' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText('配送先はまだありません')).toBeVisible();
  await expect(page.getByText('既定の配送先もありません')).toBeVisible();
});
