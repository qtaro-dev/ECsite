import { expect, test } from "@playwright/test";

test("public shell shows the demo boundary and the required search destinations", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "自作PCパーツECサイト" })).toBeVisible();
  await expect(page.getByText("実際の商品販売・課金・発送は行いません。").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "商品カテゴリ・用途・構成" }).locator('a[href^="/categories/"]')).toHaveCount(8);
  await expect(page.getByRole("link", { name: "ゲーム向け" })).toHaveAttribute("href", "/search?usage=gaming");
  await expect(page.getByRole("link", { name: "普段使い" })).toHaveAttribute("href", "/search?usage=daily");
  await expect(page.getByRole("link", { name: "動画編集" })).toHaveAttribute("href", "/search?usage=editing");
  await expect(page.getByRole("link", { name: "ヤマト運輸 料金表（公式・別タブで開く）" })).toHaveAttribute("href", "https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html");
});

test("keyboard traversal starts with the skip link and moves through labeled search controls", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "本文へ移動" });
  await expect(skipLink).toBeFocused();
  const skipLinkBounds = await skipLink.boundingBox();
  expect(skipLinkBounds?.width).toBeGreaterThanOrEqual(44);
  expect(skipLinkBounds?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "自作PCパーツECサイト トップ" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("searchbox", { name: "商品を検索" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "検索" })).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("searchbox", { name: "商品を検索" })).toBeFocused();
});

test("320 CSS-pixel phone layout has no page-level horizontal scroll and controls meet 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("searchbox", { name: "商品を検索" })).toBeVisible();

  const undersizedTargets = await page.locator("header a, header button, header input, footer a").evaluateAll((elements) =>
    elements.filter((element) => {
      if (element instanceof HTMLAnchorElement && element.hash === "#main-content") return false;
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    }).map((element) => ({ tag: element.tagName, text: element.textContent?.trim() })),
  );
  expect(undersizedTargets).toEqual([]);
});

test("200% CSS zoom emulation keeps the home page and primary controls visible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");
  // Browser chrome zoom is not exposed by Playwright; CSS zoom emulates the rendered 200% scale here.
  await page.addStyleTag({ content: "body { zoom: 200%; }" });

  const measurements = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    searchRight: document.querySelector("header input")?.getBoundingClientRect().right ?? Infinity,
  }));
  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.width);
  expect(measurements.bodyWidth).toBeLessThanOrEqual(measurements.width);
  expect(measurements.searchRight).toBeLessThanOrEqual(measurements.width);
  await expect(page.getByRole("heading", { name: "自作PCパーツECサイト" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "商品を検索" })).toBeVisible();
});
