import { expect, test } from "@playwright/test";

const emptyResult = { data: { items: [], total: 0, page: 1, pageSize: 24 }, requestId: "test-request" };

test("home offers all three use cases and eight category destinations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "用途別から探す" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ゲーミングPC/ })).toHaveAttribute("href", "/prebuilt-pc/gaming");
  await expect(page.getByRole("link", { name: /一般用途向けPC/ })).toHaveAttribute("href", "/prebuilt-pc/daily");
  await expect(page.getByRole("link", { name: /クリエイターPC/ })).toHaveAttribute("href", "/prebuilt-pc/editing");
  await expect(page.locator("main a[href^='/categories/']")).toHaveCount(8);
});

test("home routes to storage and its SSD and HDD lists keep separate filters", async ({ page }) => {
  const requestedCategories = new Set<string>();
  await page.route("**/api/products**", async (route) => {
    const category = new URL(route.request().url()).searchParams.get("category");
    if (category) requestedCategories.add(category);
    await route.fulfill({ json: emptyResult });
  });
  await page.setViewportSize({ width: 320, height: 844 });

  await page.goto("/");
  await page.locator('main a[href="/categories/storage"]').click();
  await expect(page.getByRole("heading", { name: "ストレージ", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  for (const category of ["ssd", "hdd"]) {
    await page.locator(`main a[href="/categories/${category}"]`).click();
    await expect(page).toHaveURL(`/categories/${category}`);
    await expect(page.getByRole("heading", { name: `${category.toUpperCase()}に公開中の商品はありません` })).toBeVisible();
    const breadcrumb = page.getByRole("navigation", { name: "パンくずリスト" });
    await expect(breadcrumb.getByRole("link", { name: "トップ" })).toHaveAttribute("href", "/");
    await expect(breadcrumb.getByText(category.toUpperCase(), { exact: true })).toHaveAttribute("aria-current", "page");
    await breadcrumb.getByRole("link", { name: "ストレージ" }).click();
    await expect(page).toHaveURL("/categories/storage");
  }
  expect([...requestedCategories]).toEqual(["ssd", "hdd"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('main a[href="/categories/ssd"]')).toBeVisible();
  await expect(page.locator('main a[href="/categories/hdd"]')).toBeVisible();
});

test("product cards fall back for missing, failed, or one-pixel images and keep registered photos", async ({ page }) => {
  const part = { id: "part", sku: "T74-PART", name: "Test HDD", brand: "Demo", category: "hdd", description: "",
    beginnerNote: "", priceYen: 6980, useCases: [], specifications: { capacity_gb: 1000 } };
  await page.route("**/api/product-images/test/hdd.png", (route) => route.fulfill({ path: "public/images/home-category/05_storage.png" }));
  await page.route("**/api/product-images/test/hdd-unavailable.png", (route) => route.fulfill({ status: 403 }));
  await page.route("**/api/products**", (route) => route.fulfill({ json: {
    ...emptyResult, data: { ...emptyResult.data, total: 4, items: [
      { ...part, slug: "hdd-no-image", images: [] },
      { ...part, id: "with-image", slug: "hdd-with-image", images: [{ path: "test/hdd.png", altText: "登録画像" }] },
      { ...part, id: "failed-image", slug: "hdd-failed-image", images: [{ path: "test/hdd-unavailable.png", altText: "取得できない画像" }] },
      { ...part, id: "pixel-image", slug: "hdd-pixel-image", images: [{ path: "t11/t11-cpu-am5.png", altText: "仮画像" }] },
    ] },
  } }));
  await page.goto("/categories/hdd");
  for (const slug of ["hdd-no-image", "hdd-failed-image", "hdd-pixel-image"]) {
    const fallback = page.locator("article").filter({ has: page.locator('a[href="/products/' + slug + '"]') });
    await expect(fallback.getByText("カテゴリのイメージ")).toBeVisible();
    await expect(fallback.locator("img")).toHaveAttribute("src", /05_storage\.png/);
    await expect.poll(() => fallback.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(1);
  }
  const registered = page.locator('article').filter({ has: page.locator('a[href="/products/hdd-with-image"]') });
  await expect(registered.getByRole("img", { name: "登録画像" })).toHaveAttribute("src", "/api/product-images/test/hdd.png");
  await expect.poll(() => registered.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(1);
  await expect(registered.getByText("カテゴリのイメージ")).toHaveCount(0);
});

test("category filters keep their URL conditions, force the path category, and show a clear empty state", async ({ page }) => {
  let requested: URL | undefined;
  await page.route("**/api/products**", async (route) => {
    requested = new URL(route.request().url());
    await route.fulfill({ json: emptyResult });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/categories/pc-case?minGpuClearanceMm=320&sort=price_asc");
  await expect(page.getByRole("heading", { name: "条件に合う商品が見つかりませんでした" })).toBeVisible();
  expect(requested?.searchParams.get("category")).toBe("pc-case");
  expect(requested?.searchParams.get("minGpuClearanceMm")).toBe("320");
  expect(requested?.searchParams.get("sort")).toBe("price_asc");
  await expect(page.getByRole("link", { name: "条件を解除する" })).toHaveAttribute("href", "/categories/pc-case");
  await page.getByRole("link", { name: "条件を解除する" }).click();
  await expect(page).toHaveURL(/\/categories\/pc-case$/);
});

test("an empty category explains that it has no published products and offers other routes", async ({ page }) => {
  await page.route("**/api/products**", async (route) => route.fulfill({ json: emptyResult }));
  await page.goto("/categories/ssd");
  await expect(page.getByRole("heading", { name: "SSDに公開中の商品はありません" })).toBeVisible();
  await expect(page.getByRole("link", { name: "カテゴリを選び直す" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "すべての商品を見る" })).toHaveAttribute("href", "/search");
  await expect(page.getByRole("link", { name: "条件を解除する" })).toHaveCount(0);
});

test("search shows current prices and removes a product after the result changes", async ({ page }) => {
  let priceYen = 9999;
  let published = true;
  await page.route("**/api/products**", async (route) => route.fulfill({ json: {
    data: { items: published ? [{ id: "cpu-1", slug: "cpu-one", sku: "CPU-1", name: "Fixture CPU", brand: "Fixture Works", category: "cpu", description: "Synthetic fixture", beginnerNote: "Synthetic fixture", priceYen, images: [], useCases: [], specifications: { socket_code: "AM5" } }] : [], total: published ? 1 : 0, page: 1, pageSize: 24 },
    requestId: "catalog-regression",
  } }));

  await page.goto("/search?q=Fixture");
  await expect(page.getByText("¥9,999", { exact: false })).toBeVisible();
  priceYen = 12999;
  await page.reload();
  await expect(page.getByText("¥12,999", { exact: false })).toBeVisible();
  published = false;
  await page.reload();
  await expect(page.getByRole("link", { name: "Fixture CPUの商品詳細" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "条件に合う商品が見つかりませんでした" })).toBeVisible();
});

test("mobile filter panel opens, applies specification and price conditions, and browser history restores the URL", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/products**", async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({ json: emptyResult });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search?category=cpu");
  await expect(page.getByRole("heading", { name: "条件に合う商品が見つかりませんでした" })).toBeVisible();
  await expect(page.getByRole("link", { name: "条件を解除する" })).toHaveAttribute("href", "/search");
  const toggle = page.locator("button[aria-controls='catalog-filters']");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("メーカー").fill("Example");
  await page.getByLabel("ソケット").fill("AM5");
  await page.getByLabel("下限").fill("1000");
  await page.getByRole("button", { name: "条件を適用" }).click();
  await expect(page).toHaveURL(/manufacturer=Example/);
  await expect(page).toHaveURL(/spec=/);
  await expect(page).toHaveURL(/minPrice=1000/);
  await expect.poll(() => requests.at(-1)?.searchParams.get("spec")).toBe('{"socket_code":"AM5"}');
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?category=cpu$/);
  await expect.poll(() => requests.at(-1)?.searchParams.get("category")).toBe("cpu");
});

test("retry performs another request after a catalog service error", async ({ page }) => {
  let attempts = 0;
  let retryRequested = false;
  await page.route("**/api/products**", async (route) => {
    attempts += 1;
    if (!retryRequested) await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" }, requestId: "test" } });
    else await route.fulfill({ json: emptyResult });
  });
  await page.goto("/search");
  await expect(page.locator("section[aria-labelledby='results-title'] [role='alert']")).toContainText("商品を読み込めませんでした");
  const initialAttempts = attempts;
  retryRequested = true;
  await page.getByRole("button", { name: "もう一度試す" }).click();
  await expect(page.getByRole("heading", { name: "現在公開中の商品はありません" })).toBeVisible();
  expect(attempts).toBeGreaterThan(initialAttempts);
});

test("invalid category routes return 404", async ({ page }) => {
  const response = await page.goto("/categories/not-a-category");
  expect(response?.status()).toBe(404);
});
