import { expect, test } from '@playwright/test';

// WP-16: the farm development enquiry works with JavaScript off (plain multipart POST + 303 back).
// Needs the enquiries + customers modules enabled (route stub /api/enquiry) and a test database.
test.describe('build farm with us (no JS)', () => {
  test.use({ javaScriptEnabled: false });

  test('submits the enquiry form and shows the confirmation', async ({ page }) => {
    await page.goto('/build-farm-with-us?utm_source=e2e');
    await page.getByLabel('Your name').fill('E2E Farmer');
    await page.getByLabel('Mobile number').fill('9876501234');
    await page.getByLabel('Land size in acres').fill('3');
    await page.getByLabel('Where is the land?').fill('Chikkaballapur');
    // The time trap rejects posts within 2 s of render.
    await page.waitForTimeout(2200);
    await page.locator('[data-cta="enquiry-submit"]').click();
    await expect(page).toHaveURL(/\/build-farm-with-us\?utm_source=e2e&enquiry=sent#enquiry$/);
    await expect(page.getByRole('status')).toContainText('We have your enquiry');
  });
});
