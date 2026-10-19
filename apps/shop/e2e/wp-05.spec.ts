import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// WP-05: search + facets on /search (needs the `search` module enabled and a seeded catalogue with
// mango products; seed data is WP-14's). Facet behaviour is identical on catalog listings that mount
// <FacetProvider>. The same steps were run by hand against `next start` with a fixture catalogue.
const SEARCH = '/search?q=mango';
const count = (page: Page) => page.locator('p[aria-live="polite"]').first();

test.describe('search and facets', () => {
  for (const width of [375, 1440]) {
    test(`axe clean and no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(SEARCH);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => v.id)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('desktop: toggles push URL state in fixed order; back and forward restore the selection', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(SEARCH);
    await page.locator('#fs-size-large').check();
    await expect(page).toHaveURL(/\?q=mango&f=size:large$/);
    await page.locator('#fs-size-medium').check();
    await expect(page).toHaveURL(/f=size:large,medium/);
    await page.goBack();
    await expect(page).toHaveURL(/f=size:large$/);
    await expect(page.locator('#fs-size-medium')).not.toBeChecked();
    await page.goForward();
    await expect(page.locator('#fs-size-medium')).toBeChecked();
    await page.locator('[data-cta="filter-clear-all"]').click();
    await expect(page).toHaveURL(/f=stock:$/);
  });

  test('mobile: the sheet shows a live count and changes nothing until Apply', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(SEARCH);
    const before = await count(page).textContent();
    await page.locator('[data-cta="filter-sheet-open"]').click();
    await page.locator('#sh-size-large').check();
    await expect(page.locator('[data-cta="filter-sheet-apply"]')).toHaveText(/Show \d+ results?|No results/);
    await expect(page).toHaveURL(/\?q=mango$/);
    expect(await count(page).textContent()).toBe(before);
    await page.locator('[data-cta="filter-sheet-apply"]').click();
    await expect(page).toHaveURL(/f=size:large/);
  });

  test('zero results: drop chips and closest matches, combination logged', async ({ page }) => {
    const logged = page.waitForRequest((r) => r.url().endsWith('/api/search/log') && r.method() === 'POST');
    await page.goto('/search?q=mango&f=size:small;model:miyawaki');
    await expect(page.getByText(/No results match/)).toBeVisible();
    await expect(page.locator('[data-cta="zero-drop-filter"]').first()).toBeVisible();
    await logged;
  });

  test('typeahead suggests after 2 characters, arrow keys and Enter open the product', async ({ page }) => {
    await page.goto('/search');
    await page.locator('input[name="q"]').fill('ma');
    await expect(page.locator('[role="listbox"] [role="option"]').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/\/search/);
  });
});
