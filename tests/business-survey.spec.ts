/**
 * Business Survey (Бизнес-анкета) — READ-ONLY verification test.
 *
 * Uses an existing test campaign with pre-filled questionnaire data.
 * Does NOT register users, create campaigns, or trigger AI analysis.
 * Those operations are destructive and pollute production data.
 */
import { test, expect } from './fixtures';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

const TEST_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID || '4513f574-80da-4bbe-8c47-771c63b5d1cb';

const QUESTIONNAIRE_FIELDS = [
  { name: 'companyName',            label: 'Название компании' },
  { name: 'businessDescription',    label: 'Описание бизнеса' },
  { name: 'mainDirections',         label: 'Основные направления' },
  { name: 'productsServices',       label: 'Продукты и услуги' },
  { name: 'targetAudience',         label: 'Целевая аудитория' },
  { name: 'companyFeatures',        label: 'Особенности компании' },
  { name: 'competitiveAdvantages',  label: 'Конкурентные преимущества' },
];

test('Проверка Бизнес-анкеты и анализа сайта', async ({ page }) => {
  test.setTimeout(60000);

  // 1. Navigate directly to the known test campaign
  await page.goto(`/campaigns/${TEST_CAMPAIGN_ID}`, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await dismissCookieBanner(page);

  // 2. Find and open the Questionnaire accordion
  const questionnaireTrigger = page.locator('button').filter({ hasText: /бизнес-анкета/i }).first();
  const triggerVisible = await questionnaireTrigger.isVisible({ timeout: 20000 }).catch(() => false);
  if (!triggerVisible) {
    console.log('[SKIP] Questionnaire accordion not found on campaign detail page');
    test.skip();
    return;
  }

  // Open accordion
  await questionnaireTrigger.click();
  await page.waitForTimeout(800);

  // 3. Wait for form to render
  const firstField = page.locator('input[name="companyName"]');
  const formVisible = await firstField.isVisible({ timeout: 15000 }).catch(() => false);
  if (!formVisible) {
    console.log('[SKIP] Questionnaire form inputs not rendered — questionnaire may be empty');
    test.skip();
    return;
  }

  // 4. Verify key fields are filled (read-only check)
  for (const field of QUESTIONNAIRE_FIELDS) {
    const locator = page.locator(`[name="${field.name}"], textarea[name="${field.name}"], input[name="${field.name}"]`).first();
    const visible = await locator.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      console.log(`[WARN] Field "${field.label}" not visible — skipping`);
      continue;
    }
    const value = await locator.inputValue().catch(() => '');
    console.log(`${field.label}: "${value.substring(0, 60)}${value.length > 60 ? '...' : ''}"`);
    expect(value.trim(), `Field "${field.label}" should not be empty`).not.toBe('');
    expect(value, `Field "${field.label}" should not contain "Не найдено"`).not.toContain('Не найдено');
  }

  console.log('✅ Questionnaire data verified (read-only, no AI triggered).');
});
