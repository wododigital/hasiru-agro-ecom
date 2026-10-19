import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WP-01: @ecomkit/ui stories page (/admin/dev/ui, dev and test builds: ENABLE_MOCKS=1).
// Needs the `ui` module enabled so modules:sync writes the route stub, and a staff session once admin gating lands.
const URL = '/admin/dev/ui';

test.describe('ui primitives', () => {
  for (const width of [375, 1440]) {
    test(`axe clean and no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(URL);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('QtyStepper: Add becomes stepper, Enter commits, step 10 from 100', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add, Alphonso mango' }).click();
    await expect(page.getByTestId('card-qty')).toHaveText('qty 1');
    const group = page.getByRole('group', { name: 'Quantity, Teak' });
    await group.getByRole('textbox').fill('150');
    await group.getByRole('textbox').press('Enter');
    await expect(page.getByTestId('cart-qty')).toHaveText('qty 150');
    await group.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('cart-qty')).toHaveText('qty 160');
  });

  test('Dialog traps focus and closes on Esc; Sheet closes on its button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL);
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const dialog = page.getByRole('dialog', { name: 'Plant calculator' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Open menu drawer' }).click();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('Toast announces in a live region', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Show toast' }).click();
    await expect(page.getByText('Added 10 Alphonso mango')).toBeVisible();
    await expect(page.locator('[aria-live]').first()).toBeAttached();
  });

  test('Rail arrows: back disabled at start, enabled after scrolling forward', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    const back = page.getByRole('button', { name: 'Scroll back' });
    await expect(back).toBeDisabled();
    await page.getByRole('button', { name: 'Scroll forward' }).click();
    await expect(back).toBeEnabled();
  });
});
