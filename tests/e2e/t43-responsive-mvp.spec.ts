import { expect, test } from '@playwright/test';

const emptyCatalog = {
  data: { items: [], total: 0, page: 1, pageSize: 24 },
  requestId: 't43-responsive',
};
const emptyCart = {
  data: { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 },
  requestId: 't43-responsive-cart',
};
const orderId = '00000000-0000-4000-8000-000000000043';
// A 640px CSS viewport represents a 1280px viewport at 200% browser zoom.
const widths = [320, 640, 767, 768, 1199, 1200];
const publicRoutes = [
  '/',
  '/search',
  '/cart',
  '/login?next=%2Fcart',
  `/checkout/status?orderId=${orderId}&session_id=cs_test_t43_return`,
];

test('MVP public pages fit mobile, 200%-equivalent, tablet, and desktop CSS viewports', async ({ page }) => {
  // The full 30-navigation matrix can approach the default 30s test timeout when
  // the T45 browser journeys run alongside it on a resource-limited CI worker.
  test.setTimeout(90_000);
  await page.route('**/api/products**', (route) => route.fulfill({ json: emptyCatalog }));
  await page.route('**/api/cart**', (route) => route.fulfill({ json: emptyCart }));
  await page.route('**/api/checkout/status**', (route) => route.fulfill({ json: {
    data: { status: 'payment_pending', guidance: '決済通知を待っています。', retryEligible: false },
    requestId: 't43-responsive-status',
  } }));

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of publicRoutes) {
      await page.goto(route);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth), {
        message: `${route} should not create page-level horizontal scrolling at ${width}px CSS width`,
      }).toBeLessThanOrEqual(width);

      const search = page.locator('header [role="search"]');
      for (const control of [search.locator('input'), search.getByRole('button')]) {
        const bounds = await control.boundingBox();
        expect(bounds, `${route} header search control should be visible at ${width}px`).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test('skip link and search filters work from the keyboard at mobile and tablet widths', async ({ page }) => {
  await page.route('**/api/products**', (route) => route.fulfill({ json: emptyCatalog }));

  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/search');
    const skipLink = page.getByRole('link', { name: '本文へ移動' });
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    expect(await skipLink.evaluate((element) => getComputedStyle(element).clipPath)).not.toBe('inset(50%)');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    const filterToggle = page.locator("button[aria-controls='catalog-filters']");
    await filterToggle.focus();
    await page.keyboard.press('Space');
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('メーカー')).toBeVisible();
  }
});
