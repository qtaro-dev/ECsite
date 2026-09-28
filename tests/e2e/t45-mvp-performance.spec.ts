import { expect, test } from '@playwright/test';

type Measurement = {
  url: string;
  viewport: { width: number; height: number };
  lcpMs: number | null;
  cls: number;
  inpMs: number | null;
  interactionCount: number;
  targets: { lcpMs: number; cls: number; inpMs: number };
  targetStatus: { lcp: 'within-target' | 'over-target' | 'not-measured'; cls: 'within-target' | 'over-target'; inp: 'within-target' | 'over-target' | 'not-measured' };
  caveat: string;
};

test('records repeatable Web Vitals candidates for the public home page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const state = { lcpMs: null as number | null, cls: 0, interactions: new Map<number, number>() };
    Object.defineProperty(window, '__t45Vitals', { value: state, configurable: false });
    if (!('PerformanceObserver' in window)) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcpMs = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* Unsupported browser entry type is reflected as a missing measurement. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) state.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* Unsupported browser entry type is reflected as a zero sample. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number; interactionId: number }>) {
          if (entry.interactionId > 0) state.interactions.set(entry.interactionId,
            Math.max(state.interactions.get(entry.interactionId) ?? 0, entry.duration));
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch { /* Unsupported browser entry type is reflected as a missing measurement. */ }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /自分に合うパーツから/ })).toBeVisible();
  await page.getByRole('searchbox', { name: '商品名・型番で検索' }).click();
  await page.waitForTimeout(150);
  const sample = await page.evaluate(() => {
    const state = (window as typeof window & { __t45Vitals: { lcpMs: number | null; cls: number; interactions: Map<number, number> } }).__t45Vitals;
    const sorted = [...state.interactions.values()].sort((a, b) => b - a);
    // For fewer than 50 interactions Web Vitals uses the maximum; this page intentionally
    // records one representative, non-navigation interaction per run.
    return { lcpMs: state.lcpMs, cls: state.cls, inpMs: sorted[0] ?? null, interactionCount: sorted.length };
  });
  const measurement: Measurement = {
    url: new URL(page.url()).pathname,
    viewport: { width: 1280, height: 800 },
    ...sample,
    targets: { lcpMs: 2500, cls: 0.1, inpMs: 200 },
    targetStatus: {
      lcp: sample.lcpMs === null ? 'not-measured' : sample.lcpMs <= 2500 ? 'within-target' : 'over-target',
      cls: sample.cls <= 0.1 ? 'within-target' : 'over-target',
      inp: sample.inpMs === null ? 'not-measured' : sample.inpMs <= 200 ? 'within-target' : 'over-target',
    },
    caveat: 'Single local Chromium run against Next.js development server; informational only, not hosted Preview/Production evidence. INP is the maximum observed interaction duration in this single-interaction sample. Repeat in a production-like and hosted environment before accepting T45 performance goals.',
  };
  console.log(`T45_WEB_VITALS ${JSON.stringify(measurement)}`);
  await testInfo.attach('t45-web-vitals.json', {
    body: Buffer.from(JSON.stringify(measurement, null, 2)),
    contentType: 'application/json',
  });
  expect(sample.lcpMs, 'Chromium should expose an LCP candidate for the public home page').not.toBeNull();
  expect(sample.interactionCount, 'the measured home page must include a real browser interaction').toBeGreaterThan(0);
});
