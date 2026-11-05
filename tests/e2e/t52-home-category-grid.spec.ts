import { expect, test } from "@playwright/test";

const viewportWidths = [320, 768, 1199, 1200, 1440, 1920];

test("home category section aligns with purpose content and preserves responsive columns", async ({ page }) => {
  const section = page.locator('section[aria-labelledby="category-title"]');
  const purposeSection = page.locator('section[aria-labelledby="use-title"]');
  const cards = section.locator('a[href^="/categories/"]');

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "用途別から探す" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "パーツ一覧" })).toBeVisible();
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
        purposeSection: document.querySelector<HTMLElement>('[aria-labelledby="use-title"]')
          ? box(document.querySelector<HTMLElement>('[aria-labelledby="use-title"]')!)
          : null,
        cards: cardElements.map(box),
      };
    });

    expect(geometry.cards).toHaveLength(8);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.section?.x).toBeCloseTo(geometry.purposeSection?.x ?? -1, 0);
    expect(geometry.section?.width).toBeCloseTo(geometry.purposeSection?.width ?? -1, 0);

    const distinct = (values: number[]) => values
      .sort((left, right) => left - right)
      .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > 1);
    const columns = distinct(geometry.cards.map((card) => card.x));
    const rows = distinct(geometry.cards.map((card) => card.y));
    const cardWidths = geometry.cards.map((card) => card.width);

    if (width >= 1200) {
      expect(columns).toHaveLength(4);
      expect(rows).toHaveLength(2);
      expect(Math.max(...cardWidths) - Math.min(...cardWidths)).toBeLessThanOrEqual(1);
    } else {
      expect(columns).toHaveLength(width < 768 ? 2 : 3);
    }
  }
});
