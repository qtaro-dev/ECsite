import { expect, test } from "@playwright/test";

test("published detail shows specifications and saves the chosen quantity without leaving the product", async ({ page }) => {
  await page.route("**/api/product-images/t11/t11-cpu-am5.png", (route) => route.fulfill({ path: "public/images/home-category/01_cpu.png" }));
  await page.goto("/products/t11-cpu-am5");
  await expect(page.getByRole("heading", { name: "T11 Test CPU AM5" })).toBeVisible();
  await expect(page.getByText("AM5", { exact: true })).toBeVisible();
  await expect(page.getByText("販売可能：5点")).toBeVisible();
  const image = page.locator("img[alt='合成されたテスト用プレースホルダー画像']");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(1);
  const quantity = page.getByLabel("数量");
  await quantity.fill("3");
  const add = page.getByRole("button", { name: "カートに追加" });
  await expect(page.getByRole("link", { name: "構成に追加" })).toHaveCount(0);
  const badge = page.locator('header a[href="/cart"]');
  for (const value of [3, 2]) {
    await quantity.fill(String(value));
    const response = page.waitForResponse((result) => result.url().endsWith("/api/cart") && result.request().method() === "PUT");
    await add.click();
    const saved = await response;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON()).toMatchObject({ quantity: value });
    await expect(page.getByText("商品をカートに追加しました。", { exact: false })).toBeVisible();
    await expect(page).toHaveURL("/products/t11-cpu-am5");
    await expect(badge).toHaveAccessibleName("カート（商品" + value + "点）");
  }
});

test("sold out products cannot advance to the cart", async ({ page }) => {
  await page.goto("/products/t11-gpu-300");
  await expect(page.getByRole("heading", { name: "T11 Test GPU 300 mm" })).toBeVisible();
  await expect(page.getByRole("status").getByText("在庫切れ", { exact: true })).toBeVisible();
  await expect(page.getByLabel("数量")).toBeDisabled();
  await expect(page.getByRole("button", { name: "カートに追加" })).toBeDisabled();
});

test("missing specification values remain explained when failed images use a category illustration", async ({ page }) => {
  await page.route("**/api/product-images/**", async (route) => route.fulfill({ status: 404 }));
  await page.goto("/products/t11-cpu-unknown");
  const gallery = page.getByRole("region", { name: "商品画像" });
  await expect(gallery.getByText("カテゴリのイメージ")).toBeVisible();
  await expect(gallery.locator("img")).toHaveAttribute("src", "/images/home-category/01_cpu.png");
  await expect(page.getByText("次の仕様は登録されていません：ソケット。", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "同じカテゴリの商品一覧" })).toHaveAttribute("href", "/categories/cpu");
});

test("a one-pixel product image loads the correct category illustration", async ({ page }) => {
  await page.goto("/products/t11-ssd");
  const gallery = page.getByRole("region", { name: "商品画像" });
  await expect(gallery.getByText("カテゴリのイメージ")).toBeVisible();
  await expect(gallery.locator("img")).toHaveAttribute("src", "/images/home-category/05_storage.png");
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

test("a pending add is disabled and stock or network failures preserve quantity on the detail page", async ({ page }) => {
  let finishRequest = () => {};
  const pending = new Promise<void>((resolve) => { finishRequest = resolve; });
  let attempts = 0;
  await page.route("**/api/cart", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts++;
    if (attempts > 1) return route.abort();
    await pending;
    return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
  });
  await page.goto("/products/t11-cpu-am5");
  const quantity = page.getByLabel("数量");
  const purchaseAlert = page.getByRole("region", { name: "購入", exact: true }).getByRole("alert");
  await quantity.fill("3");
  await page.getByRole("button", { name: "カートに追加" }).click();
  await expect(page.getByRole("button", { name: "追加中…" })).toBeDisabled();
  finishRequest();
  await expect(purchaseAlert).toContainText("販売可能数が更新されました");
  await expect(quantity).toHaveValue("3");
  await page.getByRole("button", { name: "カートに追加" }).click();
  await expect(purchaseAlert).toContainText("通信状態を確認して再試行してください");
  await expect(quantity).toHaveValue("3");
  await expect(page).toHaveURL("/products/t11-cpu-am5");
  await expect(page.locator('header a[href="/cart"]')).toHaveAccessibleName("カート");
  expect(attempts).toBe(2);
});
