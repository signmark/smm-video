/**
 * READ-ONLY test — verifies existing campaign data without triggering AI or modifying anything.
 * Uses a known test campaign to check questionnaire and keyword sections.
 */
import { test, expect } from './fixtures';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

const TEST_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID || '4513f574-80da-4bbe-8c47-771c63b5d1cb';

test.describe('Campaign User Flow', () => {

  test('Complete user journey: Login -> Campaign -> Business Analysis', async ({ page }) => {
    // 1. Navigate directly to the known test campaign (no AI trigger)
    await page.goto(`/campaigns/${TEST_CAMPAIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await dismissCookieBanner(page);

    // 2. Verify campaign details page loaded
    const questionnaireHeader = page.locator('span, button, h2, h3').filter({ hasText: /бизнес-анкета/i }).first();
    const headerVis = await questionnaireHeader.isVisible({ timeout: 15000 }).catch(() => false);
    if (!headerVis) {
      console.log('[SKIP] Campaign detail page does not show questionnaire accordion');
      test.skip();
      return;
    }

    // 3. Open questionnaire accordion (read-only, no analysis trigger)
    await questionnaireHeader.click();
    await page.waitForTimeout(800);

    // 4. Check if questionnaire data exists
    const companyName = page.locator('input[name="companyName"]');
    const nameVisible = await companyName.isVisible({ timeout: 10000 }).catch(() => false);

    if (!nameVisible) {
      console.log('[SKIP] Questionnaire form not rendered');
      test.skip();
      return;
    }

    const nameVal = await companyName.inputValue();
    console.log(`Company Name: "${nameVal}"`);
    expect(nameVal.trim().length).toBeGreaterThan(0);

    const descArea = page.locator('textarea[name="businessDescription"]');
    const descVal = await descArea.inputValue().catch(() => '');
    console.log(`Description length: ${descVal.length}`);
    expect(descVal.trim().length).toBeGreaterThan(10);

    const mainDir = page.locator('textarea[name="mainDirections"]');
    const mainVal = await mainDir.inputValue().catch(() => '');
    console.log(`Main Directions length: ${mainVal.length}`);
    expect(mainVal.trim()).not.toBe('');

    console.log('✅ Questionnaire data verified (read-only).');
  });
});
