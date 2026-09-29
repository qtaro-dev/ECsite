import { expect, test } from "@playwright/test";

const viewportWidths = [320, 768, 1199, 1200, 1440, 1920];

test("home category cards use the available width and preserve responsive columns", async ({ page }) => {
  const section = page.locator('section[aria-labelledby="category-title"]');
  const cards = section.locator('a[href^="/categories/"]');

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(cards).toHaveCount(8);
    await expect(cards.first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const sectionElement = document.querySelector<HTMLElement>('[aria-labelledby="category-title"]');
      const cardElements = [...(sectionElement?.querySelectorAll<HTMLAnchorElement>('a[href^="/categories/"]') ?? [])];
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        section: sectionElement ? box(sectionElement) : null,
        cards: cardElements.map(box),
      };
    });

    expect(geometry.cards).toHaveLength(8);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const distinct = (values: number[]) => values
      .sort((left, right) => left - right)
      .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > 1);
    const columns = distinct(geometry.cards.map((card) => card.x));
    const rows = distinct(geometry.cards.map((card) => card.y));
    const cardWidths = geometry.cards.map((card) => card.width);

    if (width >= 1200) {
      expect(geometry.section?.x).toBeCloseTo(0, 0);
      expect(geometry.section?.width).toBeCloseTo(geometry.viewportWidth, 0);
      expect(columns).toHaveLength(4);
      expect(rows).toHaveLength(2);
      expect(Math.max(...cardWidths) - Math.min(...cardWidths)).toBeLessThanOrEqual(1);
    } else {
      expect(columns).toHaveLength(width < 768 ? 2 : 3);
    }
  }
});
