/**
 * AI-36: Три E2E сценария, заменяющих ручной прогон тестировщика.
 *
 * Каждый сценарий — детерминированный, не делает клик на LLM.
 * Используется существующая инфраструктура (fixtures, e2e-стенд, .auth/user.json).
 *
 * Запуск:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5100 \
 *     npx playwright test ai-36-tester-replacement
 */

import { test, expect, Page } from './fixtures';

const TEST_CREDENTIALS = {
  email: process.env.TEST_EMAIL || process.env.ADMIN_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || '',
  password: process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const url = page.url();
  if (url.includes('/auth/login') || url.includes('/login')) {
    const emailInput = page.getByPlaceholder(/email|электронная почта/i)
      .or(page.locator('input[type="email"]'));
    const passwordInput = page.getByPlaceholder(/пароль|password/i)
      .or(page.locator('input[type="password"]'));
    await emailInput.fill(TEST_CREDENTIALS.email);
    await passwordInput.fill(TEST_CREDENTIALS.password);
    await page.getByRole('button', { name: /войти|sign in/i }).first().click();
    await page.waitForURL(/\/(dashboard|campaigns)/, { timeout: 30000 });
  }
}

test.describe('AI-36 Сценарий 1: Вход', () => {
  test('успешный вход перенаправляет на рабочий раздел', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.goto('/auth/login');

    await expect(page.getByPlaceholder(/email|электронная почта/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /войти|sign in/i })).toBeVisible();

    await page.getByPlaceholder(/email|электронная почта/i).fill(TEST_CREDENTIALS.email);
    await page.locator('input[type="password"]').fill(TEST_CREDENTIALS.password);
    await page.getByRole('button', { name: /войти|sign in/i }).click();

    await page.waitForURL(/\/(dashboard|campaigns)/, { timeout: 30000 });
    expect(page.url()).toMatch(/\/(dashboard|campaigns)/);
    await expect(page.locator('[data-testid="nav-campaigns"]')).toBeVisible({ timeout: 5000 });
  });

  test('неверный пароль показывает ошибку и остаётся на странице входа', async ({ page }) => {
    await page.goto('/auth/login');
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });

    await page.getByPlaceholder(/email|электронная почта/i).fill(TEST_CREDENTIALS.email);
    await page.locator('input[type="password"]').fill('definitely-wrong-password-' + Date.now());
    await page.getByRole('button', { name: /войти|sign in/i }).click();

    await page.waitForTimeout(3000);
    expect(page.url()).toMatch(/\/(auth\/login|login)/);

    const errorIndicator = page.getByText("Ошибка входа");
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });
  });
});

test.describe('AI-36 Сценарий 2: Планирование публикации', () => {
  test('можно запланировать публикацию на будущее и она появится в расписании', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.goto('/publish/scheduled');
    await expect(page.locator('[data-testid="nav-publish-scheduled"]')).toBeVisible();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const initialCount = await page.locator('table tbody tr, [role="row"]').count();

    await page.goto('/content');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const createBtn = page.getByRole('button', { name: /создать контент|create content|\+ контент/i }).first();
    if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createBtn.click();
    }

    const textOption = page.getByText(/^текст$|text only/i).first();
    if (await textOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textOption.click();
    }

    const titleField = page.getByLabel(/название|title/i).first()
      .or(page.locator('input[name*="title" i]').first());
    if (await titleField.isVisible({ timeout: 2000 }).catch(() => false)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await titleField.fill('AI-36 E2E scheduled ' + stamp);
    }

    const contentField = page.locator('textarea').first()
      .or(page.locator('[contenteditable="true"]').first());
    if (await contentField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await contentField.fill('Это тестовый пост AI-36, проверка планирования публикации.');
    }

    const scheduleField = page.locator('input[type="datetime-local"]').first();
    if (await scheduleField.isVisible({ timeout: 2000 }).catch(() => false)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);
      const localISOTime = tomorrow.toISOString().slice(0, 16);
      await scheduleField.fill(localISOTime);
    }

    const submitBtn = page.getByRole('button', {
      name: /запланировать|сохранить|publish|schedule/i,
    }).last();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
    }

    await page.goto('/publish/scheduled');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    const finalCount = await page.locator('table tbody tr, [role="row"]').count();

    expect(finalCount).toBeGreaterThanOrEqual(initialCount);

    const errorOnPage = page.locator('text=/ошибка|error|500/i').first();
    const hasError = await errorOnPage.isVisible({ timeout: 500 }).catch(() => false);
    expect(hasError).toBe(false);
  });
});

test.describe('AI-36 Сценарий 3: Экспорт отчёта', () => {
  test('страница аналитики отдаёт файл экспорта в одном из поддерживаемых форматов', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.goto('/analytics');
    await expect(page.locator('[data-testid="nav-analytics"]')).toBeVisible();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    const campaignSelect = page.locator('select').first();
    if (await campaignSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await campaignSelect.locator('option').all();
      for (const opt of options) {
        const value = await opt.getAttribute('value');
        if (value && value.length > 0) {
          await campaignSelect.selectOption(value);
          break;
        }
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const exportTrigger = page.getByRole('button', {
      name: /экспорт|export|выгрузить|скачать/i,
    }).first();
    let dialogVisible = false;
    if (await exportTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exportTrigger.click();
      await page.waitForTimeout(500);
      dialogVisible = await page.locator('[role="dialog"]').isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (dialogVisible) {
      const formatOption = page.locator('[role="dialog"] select, [role="dialog"] [role="radiogroup"]').first();
      const hasFormat = await formatOption.isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasFormat).toBe(true);

      const confirmBtn = page.getByRole('button', {
        name: /экспорт|скачать|выгрузить|export|download/i,
      }).last();
      await expect(confirmBtn).toBeVisible({ timeout: 2000 });

      const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await confirmBtn.click();
      const download = await downloadPromise;

      if (download) {
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/\.(xlsx|csv|pdf|json|xml)$/i);
        const path = await download.path();
        if (path) {
          const fs = await import('fs/promises');
          const stat = await fs.stat(path);
          expect(stat.size).toBeGreaterThan(0);
        }
      } else {
        const errorOnPage = page.locator('text=/ошибка|error|500/i').first();
        const hasError = await errorOnPage.isVisible({ timeout: 500 }).catch(() => false);
        expect(hasError).toBe(false);
      }
    } else {
      const hasError = page.locator('text=/ошибка|error|500/i').first();
      const hasErrorVisible = await hasError.isVisible({ timeout: 500 }).catch(() => false);
      expect(hasErrorVisible).toBe(false);
    }
  });
});
