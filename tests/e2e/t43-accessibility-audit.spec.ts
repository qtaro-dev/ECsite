import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const emptyCatalog = {
  data: { items: [], total: 0, page: 1, pageSize: 24 },
  requestId: 't43-axe-catalog',
};
const emptyCart = {
  data: { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 },
  requestId: 't43-axe-cart',
};
const orderId = '00000000-0000-4000-8000-000000000043';
const routes = [
  '/',
  '/search',
  '/cart',
  '/login?next=%2Fcart',
  `/checkout/status?orderId=${orderId}&session_id=cs_test_t43_axe`,
];

test('MVP public routes expose accessible names and meet axe WCAG 2.2 AA checks at 200%-equivalent width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.route('**/api/products**', (route) => route.fulfill({ json: emptyCatalog }));
  await page.route('**/api/cart**', (route) => route.fulfill({ json: emptyCart }));
  await page.route('**/api/checkout/status**', (route) => route.fulfill({ json: {
    data: { status: 'payment_pending', guidance: '決済通知を待っています。', retryEligible: false },
    requestId: 't43-axe-status',
  } }));

  const audits: Array<{ route: string; violations: Array<{
    id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; failureSummary?: string }>;
  }> }> = [];
  for (const route of routes) {
    await page.goto(route);
    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content') ?? '';
    expect(viewportContent).not.toMatch(/user-scalable\s*=\s*no/i);
    const maximumScale = viewportContent.match(/maximum-scale\s*=\s*([\d.]+)/i);
    expect(maximumScale ? Number(maximumScale[1]) : 2).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('main')).toHaveCount(1);
    await page.addScriptTag({ content: axe.source });
    const result = await page.evaluate(async () => {
      type Violation = { id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; failureSummary?: string }> };
      const axeOnPage = (window as unknown as Window & { axe: { run: (context: Document, options: { runOnly: { type: 'tag'; values: string[] } }) => Promise<{ violations: Violation[] }> } }).axe;
      const { violations } = await axeOnPage.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      });
      return violations;
    });
    audits.push({ route, violations: result });
  }

  await testInfo.attach('t43-axe-accessibility-audit.json', {
    body: Buffer.from(JSON.stringify(audits, null, 2)),
    contentType: 'application/json',
  });
  const failures = audits.flatMap(({ route, violations }) => violations.map((violation) => ({ route, ...violation })));
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
