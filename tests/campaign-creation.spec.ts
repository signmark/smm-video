import { test, expect } from './fixtures';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

const TEST_CREDENTIALS = {
  email: process.env.TEST_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com',
  password: process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7',
};

// Russian site accessible from production server, no bot protection, rich content
const TEST_WEBSITE_URL = 'https://habr.com';

test.describe('Campaign Creation Full Flow', () => {
  test('Create campaign with full automation (Analysis + Questionnaire + Keywords)', async ({ page }) => {
    test.setTimeout(300000);
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });
    page.on('pageerror', err => console.error(`PAGE CRASH: ${err.message}`));

    // Step 1: Navigate to campaigns
    console.log('Step 1: Navigating to /campaigns');
    await page.goto('/campaigns');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookieBanner(page);

    // Handle auth if needed
    if (page.url().includes('/auth/login') || page.url().includes('/login')) {
      console.log('Auth required, logging in...');
      await page.locator('input[type="email"]').fill(TEST_CREDENTIALS.email);
      await page.locator('input[type="password"]').fill(TEST_CREDENTIALS.password);
      await page.getByRole('button', { name: /войти/i }).first().click();
      await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);
    }

    // Wait for auth to settle and page to be interactive
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Kill Secure Privacy overlay — it blocks all pointer events
    await dismissCookieBanner(page);

    // Step 2: Open create campaign dialog
    console.log('Step 2: Opening Create Campaign dialog');
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.getByRole('button', { name: /Создать кампанию/i })).first();
    await expect(createBtn).toBeVisible({ timeout: 20000 });
    await createBtn.click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

    // Step 3: Fill form
    console.log('Step 3: Filling form');
    const campaignName = `Auto Campaign ${Date.now()}`;
    await page.getByTestId('input-campaign-name').fill(campaignName);
    await page.getByTestId('input-campaign-description').fill('Тестовая кампания для проверки автоматизации создания');
    await page.getByTestId('input-campaign-website').fill(TEST_WEBSITE_URL);

    // Step 4: Enable automation checkboxes in correct order
    console.log('Step 4: Enabling automation checkboxes');

    // First: enable site analysis (required for questionnaire)
    const analyzeCheckbox = page.getByTestId('checkbox-auto-analyze');
    await expect(analyzeCheckbox).toBeEnabled({ timeout: 5000 });
    await analyzeCheckbox.check();

    // Second: questionnaire becomes enabled once analyze is checked
    const questionnaireCheckbox = page.getByTestId('checkbox-auto-fill-questionnaire');
    await expect(questionnaireCheckbox).toBeEnabled({ timeout: 5000 });
    await questionnaireCheckbox.check();

    // Third: keywords (enabled as long as URL is filled)
    const keywordsCheckbox = page.getByTestId('checkbox-auto-generate-keywords');
    await expect(keywordsCheckbox).toBeEnabled({ timeout: 5000 });
    await keywordsCheckbox.check();

    // Step 5: Submit
    console.log('Step 5: Submitting form');
    const submitBtn = page.getByTestId('button-create-campaign');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Step 6: Watch progress and wait for completion
    console.log('Step 6: Watching progress steps');
    await expect(page.getByText('Создание кампании')).toBeVisible({ timeout: 15000 });

    console.log('Step 6: Waiting for all steps to complete (up to 120s)...');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 120000 });
    console.log('Step 6: Dialog closed — all steps done');

    // Step 7: Find and open the new campaign
    console.log('Step 7: Finding campaign in list');
    await page.waitForTimeout(2000);
    const campaignLink = page.getByText(campaignName).first();
    await expect(campaignLink).toBeVisible({ timeout: 15000 });
    await campaignLink.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Verify we're on the campaign detail page
    await expect(page.locator('text=Бизнес-анкета')).toBeVisible({ timeout: 20000 });

    // Step 8a: Open and verify Questionnaire
    console.log('Step 8a: Opening questionnaire accordion');
    // Ищем кнопку аккордеона через data-testid дочернего span или через текст
    const questionnaireTrigger = page.locator('[data-testid="text-business-questionnaire"]').locator('..')
      .or(page.getByRole('button').filter({ has: page.locator('[data-testid="text-business-questionnaire"]') }))
      .or(page.locator('button').filter({ hasText: 'Бизнес-анкета' }))
      .first();
    await expect(questionnaireTrigger).toBeVisible({ timeout: 20000 });

    // Check if already open, otherwise click to open
    const companyNameInputCheck = page.locator('input[name="companyName"]');
    const isAlreadyOpen = await companyNameInputCheck.isVisible().catch(() => false);
    if (!isAlreadyOpen) {
      await questionnaireTrigger.click();
    }

    // Wait for form to load with data from API
    await expect(companyNameInputCheck).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const companyNameValue = await companyNameInputCheck.inputValue();
    console.log(`Company Name: "${companyNameValue}"`);
    // Field must be filled (any non-empty value, including AI fallbacks like "Не найдено")
    expect(companyNameValue.trim()).not.toBe('');
    expect(companyNameValue.trim().length).toBeGreaterThan(0);

    const descriptionInput = page.locator('textarea[name="businessDescription"]');
    await expect(descriptionInput).toBeVisible({ timeout: 5000 });
    const descriptionValue = await descriptionInput.inputValue();
    console.log(`Description length: ${descriptionValue.length}`);
    expect(descriptionValue.trim().length).toBeGreaterThan(10);

    const mainDirectionsInput = page.locator('textarea[name="mainDirections"]');
    const mainDirectionsValue = await mainDirectionsInput.inputValue();
    console.log(`Main Directions length: ${mainDirectionsValue.length}`);
    expect(mainDirectionsValue.trim()).not.toBe('');

    // Step 8b: Open and verify Keywords
    // Note: accordion is type="single", opening keywords will close questionnaire
    console.log('Step 8b: Opening keywords accordion');
    const keywordsTrigger = page.getByRole('button').filter({
      has: page.locator('span', { hasText: 'Ключевые слова' })
    });
    await expect(keywordsTrigger).toBeVisible({ timeout: 10000 });
    await keywordsTrigger.click();

    // Wait for KeywordSelector to fetch and display saved keywords
    await expect(page.getByText('Выбранные ключевые слова:')).toBeVisible({ timeout: 15000 });

    // Check for at least one keyword badge (rendered as "keyword ×")
    const keywordBadge = page.locator('div, span').filter({ hasText: /\S.* ×$/ }).first();
    await expect(keywordBadge).toBeVisible({ timeout: 5000 });
    console.log('Step 8b: Keywords found');

    // Step 8c: Verify green checkmark on keywords trigger (section is complete when keywords exist)
    console.log('Step 8c: Verifying keywords completion checkmark');
    await page.waitForTimeout(500);
    const greenKeywordsCheckmark = keywordsTrigger.locator('.text-green-500');
    await expect(greenKeywordsCheckmark).toBeVisible({ timeout: 5000 });
    console.log('Step 8c: Keywords section is green');

    // Step 8d: Verify green checkmark on questionnaire trigger (always visible even when closed)
    console.log('Step 8d: Verifying questionnaire completion checkmark');
    const greenCheckmark = questionnaireTrigger.locator('.text-green-500');
    await expect(greenCheckmark).toBeVisible({ timeout: 5000 });

    console.log('Test completed successfully!');
  });
});
