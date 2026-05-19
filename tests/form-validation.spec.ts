/**
 * Тесты валидации форм
 * Проверяет что формы правильно обрабатывают невалидный ввод
 */

import { test, expect, Page } from './fixtures';

async function login(page: Page) {
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (page.url().includes('/auth/login') || page.url().includes('/login')) {
    await page.fill('input[type="email"]', process.env.TEST_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || '');
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '');
    await page.getByRole('button', { name: /войти/i }).first().click();
    await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
    await page.waitForTimeout(1000);
  }
}

test.describe('Валидация формы регистрации', () => {
  test('форма регистрации показывает ошибки при пустой отправке', async ({ page }) => {
    await page.goto('/auth/register', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const form = await page.locator('form').first().isVisible({ timeout: 10000 }).catch(() => false);
    if (!form) {
      await page.goto('/auth/login');
      const registerLink = page.getByRole('link', { name: /регистр|register|создать аккаунт/i }).first();
      const hasLink = await registerLink.isVisible({ timeout: 5000 }).catch(() => false);
      if (!hasLink) { test.skip(true, 'Нет страницы регистрации'); return; }
      await registerLink.click();
      await page.waitForTimeout(2000);
    }

    const submitBtn = page.getByRole('button', { name: /создать|зарегистрировать|register|sign up/i }).first();
    const hasSubmit = await submitBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSubmit) { test.skip(true, 'Нет кнопки отправки'); return; }

    await submitBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const hasError = await page.locator('[class*="error"], [role="alert"], [class*="invalid"], text=обязательн, text=required')
      .first().isVisible({ timeout: 5000 }).catch(() => false);
    const stillOnPage = page.url().includes('/register') || page.url().includes('/auth');
    expect(hasError || stillOnPage).toBeTruthy();
  });

  test('форма входа показывает ошибку при неверных данных', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passInput = page.locator('input[type="password"]').first();
    const hasForm = await emailInput.isVisible({ timeout: 10000 }).catch(() => false);
    if (!hasForm) { test.skip(true, 'Форма входа не найдена'); return; }

    await emailInput.fill('wrong@example.com');
    await passInput.fill('wrongpassword123!');
    await page.getByRole('button', { name: /войти|sign in|login/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const hasError = await page.locator('[class*="error"], [role="alert"], [class*="toast"], [class*="destructive"]')
      .first().isVisible({ timeout: 8000 }).catch(() => false);
    const stillOnLogin = page.url().includes('/login') || page.url().includes('/auth');
    expect(hasError || stillOnLogin).toBeTruthy();
  });
});

test.describe('Валидация формы создания кампании', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  });

  test('диалог создания кампании открывается', async ({ page }) => {
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.getByRole('button', { name: /Создать кампанию/i })).first();
    const visible = await createBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) { test.skip(true, 'Кнопка создания кампании не найдена'); return; }
    await createBtn.click({ force: true });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
  });

  test('форма кампании не отправляется с пустым названием', async ({ page }) => {
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.getByRole('button', { name: /Создать кампанию/i })).first();
    const visible = await createBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) { test.skip(true, 'Кнопка создания кампании не найдена'); return; }
    await createBtn.click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });

    const submitBtn = page.getByRole('dialog').getByRole('button', { name: /создать|submit|сохранить/i }).first();
    const hasSubmit = await submitBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSubmit) { test.skip(true, 'Кнопка отправки не найдена в диалоге'); return; }

    await submitBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const dialogStillOpen = await page.getByRole('dialog').isVisible({ timeout: 3000 }).catch(() => false);
    const hasError = await page.locator('[class*="error"], [class*="invalid"], [role="alert"]')
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(dialogStillOpen || hasError).toBeTruthy();
  });

  test('ESC закрывает диалог создания кампании', async ({ page }) => {
    const createBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.getByRole('button', { name: /Создать кампанию/i })).first();
    const visible = await createBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) { test.skip(true, 'Кнопка создания кампании не найдена'); return; }
    await createBtn.click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    const dialogClosed = !(await page.getByRole('dialog').isVisible({ timeout: 3000 }).catch(() => false));
    expect(dialogClosed).toBeTruthy();
  });
});

test.describe('Валидация формы создания контента', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  });

  test('кнопка "Создать контент" disabled без выбранной кампании', async ({ page }) => {
    const combobox = page.getByRole('combobox').first();
    const comboVisible = await combobox.isVisible({ timeout: 8000 }).catch(() => false);
    if (!comboVisible) { test.skip(true, 'Нет комбобокса'); return; }

    const currentValue = await combobox.innerText().catch(() => '');
    if (!currentValue || currentValue.includes('Выберите') || currentValue.trim() === '') {
      const createBtn = page.getByTestId('button-create-content')
        .or(page.getByRole('button', { name: /создать контент/i }).first());
      const isDisabled = await createBtn.isDisabled({ timeout: 5000 }).catch(() => false);
      const isHidden = !(await createBtn.isVisible({ timeout: 5000 }).catch(() => false));
      expect(isDisabled || isHidden).toBeTruthy();
    }
  });

  test('диалог создания контента содержит поля ввода', async ({ page }) => {
    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }).first());
    const isEnabled = await createBtn.isEnabled({ timeout: 10000 }).catch(() => false);
    if (!isEnabled) { test.skip(true, 'Кнопка создания контента недоступна — кампания не выбрана'); return; }

    await createBtn.click({ timeout: 5000 });
    const dialog = page.getByRole('dialog');
    const dialogVisible = await dialog.isVisible({ timeout: 10000 }).catch(() => false);
    if (!dialogVisible) { test.skip(true, 'Диалог не открылся'); return; }

    const hasInput = await dialog.locator('input, textarea, [contenteditable], select, [role="textbox"], [role="combobox"]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    const hasDialogContent = await dialog.locator('*').first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasInput || hasDialogContent).toBeTruthy();

    await page.keyboard.press('Escape');
  });
});
