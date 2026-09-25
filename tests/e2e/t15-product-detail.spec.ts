import { expect, test } from "@playwright/test";

test("published detail shows image, labeled specifications, availability, and quantity navigation", async ({ page }) => {
  await page.goto("/products/t11-cpu-am5");
  await expect(page.getByRole("heading", { name: "T11 Test CPU AM5" })).toBeVisible();
  await expect(page.getByText("AM5", { exact: true })).toBeVisible();
  await expect(page.getByText("販売可能：5点")).toBeVisible();
  await expect(page.locator("img[alt='合成されたテスト用プレースホルダー画像']")).toBeVisible();
  const quantity = page.getByLabel("数量");
  await quantity.fill("3");
  await expect(page.getByRole("link", { name: "カートへ進む" })).toHaveAttribute("href", /productId=.*&quantity=3/);
  await expect(page.getByRole("link", { name: "構成に追加" })).toHaveAttribute("href", /\/build\?category=cpu/);
});

test("sold out products cannot advance to the cart", async ({ page }) => {
  await page.goto("/products/t11-gpu-300");
  await expect(page.getByRole("heading", { name: "T11 Test GPU 300 mm" })).toBeVisible();
  await expect(page.getByRole("status").getByText("在庫切れ", { exact: true })).toBeVisible();
  await expect(page.getByLabel("数量")).toBeDisabled();
  await expect(page.getByRole("link", { name: "カートへ進む" })).toHaveCount(0);
});

test("hidden and missing products return an HTTP 404", async ({ request }) => {
  const hidden = await request.get("/products/t15-hidden");
  const missing = await request.get("/products/does-not-exist");
  expect(hidden.status()).toBe(404);
  expect(missing.status()).toBe(404);
});

test("image proxy streams a published image and denies a hidden product image", async ({ request }) => {
  const published = await request.get("/api/product-images/t11/t11-cpu-am5.png");
  expect(published.status()).toBe(200);
  expect(published.headers()["content-type"]).toContain("image/png");
  const hidden = await request.get("/api/product-images/t11/t15-hidden.png");
  expect([403, 404]).toContain(hidden.status());
});
