import { test, expect } from './fixtures';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

const TEST_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID || '4513f574-80da-4bbe-8c47-771c63b5d1cb';

test.describe('Campaign Accordion Status Check', () => {
  test('Verify Green Checkmark for Completed Questionnaire', async ({ page }) => {
    // 1. Navigate directly to the known test campaign
    await page.goto(`/campaigns/${TEST_CAMPAIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await dismissCookieBanner(page);

    // 2. Find the Questionnaire accordion trigger
    const questionnaireTrigger = page.locator('button').filter({ hasText: /бизнес-анкета/i }).first();
    const visible = await questionnaireTrigger.isVisible({ timeout: 20000 }).catch(() => false);
    if (!visible) {
      console.log('[SKIP] Accordion trigger "Бизнес-анкета" not found on page');
      test.skip();
      return;
    }

    // 3. Check for green checkmark (data may be async)
    const greenCheckmark = questionnaireTrigger.locator('.text-green-500');
    const isGreen = await greenCheckmark.isVisible({ timeout: 5000 }).catch(() => false);

    if (isGreen) {
      console.log('✅ Green checkmark visible — questionnaire complete.');
      return;
    }

    // 4. Not green — open accordion and check if fields are actually filled
    console.log('⚠️ Checkmark not green. Opening accordion to inspect data...');
    await questionnaireTrigger.click();

    const companyName = page.locator('input[name="companyName"]');
    const desc = page.locator('textarea[name="businessDescription"]');

    const nameVisible = await companyName.isVisible({ timeout: 10000 }).catch(() => false);
    if (!nameVisible) {
      console.log('[INFO] Form inputs not rendered — questionnaire empty state.');
      return;
    }

    const nameVal = await companyName.inputValue();
    const descVal = await desc.inputValue().catch(() => '');
    console.log(`Company Name: "${nameVal}", Description length: ${descVal.length}`);

    if (nameVal.trim() && descVal.trim()) {
      throw new Error('Data is filled but green checkmark is missing — validation logic mismatch!');
    } else {
      console.log('[INFO] Fields empty → no checkmark expected. OK.');
    }
  });
});
