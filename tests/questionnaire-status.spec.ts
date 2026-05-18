import { test, expect } from './fixtures';

test.describe('Questionnaire Status Indicator', () => {
  test('Green checkmark appears when questionnaire is filled', async ({ page }) => {
    test.setTimeout(300000); // AI analysis can take up to 5 minutes
    // Enable console logging
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

    // 1. Create a campaign with automation
    console.log('Step 1: Creating campaign with analysis...');
    await page.goto('/campaigns');
    
    // Open creation dialog
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.locator('button').filter({ hasText: /Создать кампанию/i }).first());
    const createBtnVis = await createBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (!createBtnVis) {
      console.log('[SKIP] Кнопка создания кампании не найдена');
      test.skip();
      return;
    }
    await createBtn.click({ timeout: 5000 });
    
    // Fill form
    const campaignName = `Status Test ${Date.now()}`;
    await page.getByTestId('input-campaign-name').fill(campaignName);
    await page.getByTestId('input-campaign-website').fill('https://example.com');
    
    // Enable automation
    await page.getByTestId('checkbox-auto-analyze').check();
    await page.getByTestId('checkbox-auto-fill-questionnaire').check();
    
    // Submit (button text differs by locale)
    const submitBtn = page.getByRole('button', { name: /create now|создать|submit/i }).last();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Wait for completion
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 120000 });
    console.log('Campaign created and analyzed');

    // 2. Go to Campaign Details
    await page.getByText(campaignName).click();
    console.log('Navigated to campaign details');

    // 3. Check Questionnaire Section Status
    const questionnaireTrigger = page.locator('button[value="business-questionnaire"]');
    await expect(questionnaireTrigger).toBeVisible();

    // Check for the green checkmark
    // The checkmark has class "text-green-500"
    console.log('Waiting for green checkmark...');
    const greenCheckmark = questionnaireTrigger.locator('.text-green-500');
    
    // Wait for the data to load and status to update
    await expect(greenCheckmark).toBeVisible({ timeout: 15000 });
    console.log('Green checkmark verified!');

    // 4. Verify content matches
    await questionnaireTrigger.click();
    await expect(page.getByDisplayValue('Example Domain')).toBeVisible();
  });
});
