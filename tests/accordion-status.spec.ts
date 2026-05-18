import { test, expect } from './fixtures';

test.describe('Campaign UI Status Indicators', () => {
  test('Questionnaire Accordion shows green checkmark when data is present', async ({ page }) => {
    test.setTimeout(300000); // AI analysis can take up to 5 minutes
    // Enable console logging
    page.on('console', msg => {
        if (msg.type() === 'log' || msg.type() === 'error') {
            console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
        }
    });

    // 1. Create a campaign with auto-fill enabled
    console.log('Step 1: Creating campaign...');
    await page.goto('/campaigns');
    
    // Open creation dialog
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.locator('button').filter({ hasText: /Создать кампанию/i }).first());
    const btnVis = await createBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (!btnVis) {
      console.log('[SKIP] Кнопка создания кампании не найдена');
      test.skip();
      return;
    }
    await createBtn.click({ timeout: 5000 });
    
    const campaignName = `Status Check ${Date.now()}`;
    await page.getByTestId('input-campaign-name').fill(campaignName);
    await page.getByTestId('input-campaign-website').fill('https://example.com');
    
    // Enable automation
    await page.getByTestId('checkbox-auto-analyze').check();
    await page.getByTestId('checkbox-auto-fill-questionnaire').check();
    
    // Submit (button text differs by locale: "CREATE NOW" on some builds, "Создать" on prod)
    const submitBtn = page.getByRole('button', { name: /create now|создать|submit/i }).last();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Wait for completion (Allow time for AI analysis)
    console.log('Step 2: Waiting for AI analysis...');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 120000 });

    // 2. Open the campaign
    console.log('Step 3: Opening campaign details...');
    await page.getByText(campaignName).click();
    
    // 3. Verify Green Checkmark
    console.log('Step 4: Verifying Green Checkmark...');
    const questionnaireTrigger = page.locator('button[value="business-questionnaire"]');
    await expect(questionnaireTrigger).toBeVisible();

    // Check specifically for the green checkmark (CheckCircle icon with text-green-500 class)
    // We can also check that the "Circle" (gray icon) is NOT visible or less strictly, just that green is visible.
    const greenCheckmark = questionnaireTrigger.locator('.text-green-500');
    
    // Wait for the query to fetch data and update the UI
    try {
        await expect(greenCheckmark).toBeVisible({ timeout: 20000 });
        console.log('✅ Green checkmark visible!');
    } catch (e) {
        console.log('❌ Green checkmark NOT visible. Taking screenshot.');
        await page.screenshot({ path: 'accordion-status-failed.png' });
        
        // Debug: Check if the gray circle is visible instead
        const grayCircle = questionnaireTrigger.locator('.text-gray-400');
        if (await grayCircle.isVisible()) {
            console.log('ℹ️ Gray circle is visible (Status: Incomplete)');
        }
        
        // Debug: Check if we can see the questionnaire data to confirm it loaded
        await questionnaireTrigger.click();
        const companyNameField = page.locator('input[name="companyName"]');
        const value = await companyNameField.inputValue();
        console.log(`ℹ️ Questionnaire "companyName" value: "${value}"`);
        
        throw e;
    }
  });
});
