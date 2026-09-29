import { expect, test } from "@playwright/test";

const useCases = [
  { slug: "gaming", title: "ゲーミングPC" },
  { slug: "daily", title: "一般用途向けPC" },
  { slug: "editing", title: "クリエイターPC" },
] as const;

test("home purpose cards open two configured PCs per use case and their detail enters the shared cart", async ({ page }) => {
  for (const useCase of useCases) {
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(useCase.title) }).click();
    await expect(page).toHaveURL(`/prebuilt-pc/${useCase.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: useCase.title })).toBeVisible();

    const products = page.locator('section[aria-label$="の商品一覧"] > article');
    await expect(products).toHaveCount(2);
    await expect(products.first().getByText(/販売可能：\d+点|在庫切れ/)).toBeVisible();
    for (const part of ["CPU", "GPU（グラフィックボード）", "メモリ", "SSD"]) {
      await expect(products.first().getByText(part, { exact: true })).toBeVisible();
    }

    await products.first().getByRole("link", { name: "構成と購入方法を見る" }).click();
    const productName = await page.getByRole("heading", { level: 1 }).textContent();
    const configuration = page.locator('section[aria-labelledby="spec-title"]');
    await expect(configuration.getByRole("heading", { name: "採用構成" })).toBeVisible();
    for (const part of ["CPU", "GPU（グラフィックボード）", "メモリ", "SSD"]) {
      await expect(configuration.getByText(part, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "構成に追加" })).toHaveCount(0);
    await page.getByRole("link", { name: "この完成PCをカートに入れる" }).click();
    await expect(page).toHaveURL(/\/cart\?productId=.*quantity=1/);
    await expect(page.getByRole("heading", { name: "カート" })).toBeVisible();
    await expect(page.getByText("商品をカートに追加しました。現在の価格と販売可能数を確認してください。")).toBeVisible();
    await expect(page.getByText(productName ?? "", { exact: false })).toBeVisible();
  }
});

test("prebuilt lists fit phone, tablet, and desktop widths without horizontal overflow", async ({ page }) => {
  for (const width of [320, 768, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/prebuilt-pc/gaming");
    await expect(page.locator('section[aria-label$="の商品一覧"] > article')).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
