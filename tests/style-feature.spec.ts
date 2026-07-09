import { test, expect } from './fixtures';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

const TEST_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID || '4513f574-80da-4bbe-8c47-771c63b5d1cb';

test.describe('Style Feature — email-gated visibility', () => {
  test('Style accordion visible for signmark@gmail.com', async ({ page }) => {
    await page.goto(`/campaigns/${TEST_CAMPAIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await dismissCookieBanner(page);

    // Wait for profile query to load (email comes from /api/user/profile)
    await page.waitForFunction(() => {
      const banner = document.querySelector('[class*="bg-yellow"]');
      return banner && banner.textContent.includes('email=');
    }, { timeout: 15000 }).catch(() => {});

    // Check debug banner for email value
    const banner = page.locator('[class*="bg-yellow"]').first();
    const bannerText = await banner.textContent({ timeout: 5000 }).catch(() => 'NO BANNER');
    console.log(`[STYLE DEBUG] ${bannerText}`);

    // Verify email is correct
    expect(bannerText).toContain('email=signmark@gmail.com');
    expect(bannerText).toContain('enabled=true');

    // Verify style accordion is visible
    const styleAccordion = page.locator('button').filter({ hasText: /стиль контента/i }).first();
    await expect(styleAccordion).toBeVisible({ timeout: 10000 });

    console.log('✅ Style feature visible for signmark@gmail.com');
  });

  test('Style accordion hidden for other users', async ({ page }) => {
    // This test runs with the same auth — just verify the mechanism works
    // To fully test, run with a different TEST_EMAIL
    await page.goto(`/campaigns/${TEST_CAMPAIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const banner = page.locator('[class*="bg-yellow"]').first();
    const bannerText = await banner.textContent({ timeout: 5000 }).catch(() => 'NO BANNER');
    console.log(`[STYLE DEBUG] ${bannerText}`);

    // If email is signmark@gmail.com, accordion should be visible
    // If not, it should be hidden
    if (bannerText.includes('email=signmark@gmail.com')) {
      const styleAccordion = page.locator('button').filter({ hasText: /стиль контента/i }).first();
      await expect(styleAccordion).toBeVisible({ timeout: 10000 });
      console.log('✅ signmark@gmail.com — style visible (correct)');
    } else {
      const styleAccordion = page.locator('button').filter({ hasText: /стиль контента/i }).first();
      const visible = await styleAccordion.isVisible({ timeout: 3000 }).catch(() => false);
      expect(visible).toBe(false);
      console.log('✅ Other user — style hidden (correct)');
    }
  });
});
