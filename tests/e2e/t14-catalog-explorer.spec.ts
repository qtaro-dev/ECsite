import { expect, test } from "@playwright/test";

const emptyResult = { data: { items: [], total: 0, page: 1, pageSize: 24 }, requestId: "test-request" };

test("home offers all three use cases and eight category destinations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "何をしたいかから探す" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ゲームを楽しみたい/ })).toHaveAttribute("href", "/search?usage=gaming");
  await expect(page.getByRole("link", { name: /普段使いのPCを作りたい/ })).toHaveAttribute("href", "/search?usage=daily");
  await expect(page.getByRole("link", { name: /動画編集をしたい/ })).toHaveAttribute("href", "/search?usage=editing");
  await expect(page.locator("main a[href^='/categories/']")).toHaveCount(8);
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

test("mobile filter panel opens, applies specification and price conditions, and browser history restores the URL", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/products**", async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({ json: emptyResult });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search?category=cpu");
  await expect(page.getByRole("heading", { name: "条件に合う商品が見つかりませんでした" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "条件に合う商品が見つかりませんでした" })).toBeVisible();
  expect(attempts).toBeGreaterThan(initialAttempts);
});

test("invalid category routes return 404", async ({ page }) => {
  const response = await page.goto("/categories/not-a-category");
  expect(response?.status()).toBe(404);
});
