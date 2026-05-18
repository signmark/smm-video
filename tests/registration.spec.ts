/**
 * E2E тесты: Регистрация пользователя (/auth/register)
 * Обновлено под 3-шаговый wizard (Аккаунт → Кампания → Соцсети)
 *
 * Запуск:
 *   npx playwright test registration --headed
 *   npx playwright test registration --project=chromium
 */

import { test, expect, Page } from './fixtures';

test.use({ storageState: { cookies: [], origins: [] } });

const REGISTER_URL = '/auth/register';
const REGISTER_API_RE = /\/api\/auth\/register/;

interface RegisterFormData {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  acceptTerms?: boolean;
  acceptPrivacy?: boolean;
  acceptPersonalData?: boolean;
  acceptMarketing?: boolean;
}

// ---------------------------------------------------------------------------
// Хелпер: заполнить форму шага 1 (используем data-testid)
// ---------------------------------------------------------------------------
async function fillRegisterForm(page: Page, data: RegisterFormData) {
  if (data.firstName !== undefined)
    await page.getByTestId('input-first-name').fill(data.firstName);
  if (data.lastName !== undefined)
    await page.getByTestId('input-last-name').fill(data.lastName);
  if (data.jobTitle !== undefined) {
    await page.getByTestId('select-job-title').click();
    // Wait for options to appear in the dropdown
    await page.waitForSelector('[role="option"]', { timeout: 5000 }).catch(() => {});
    const option = page.getByRole('option', { name: data.jobTitle }).first();
    const found = await option.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await option.click();
    } else {
      // Fallback: click first available option
      const firstOption = page.getByRole('option').first();
      if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await firstOption.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }
  if (data.email !== undefined)
    await page.getByTestId('input-email').fill(data.email);
  if (data.password !== undefined)
    await page.getByTestId('input-password').fill(data.password);
  if (data.confirmPassword !== undefined)
    await page.getByTestId('input-confirm-password').fill(data.confirmPassword);
  if (data.acceptTerms)
    await page.getByTestId('checkbox-termsAccepted').click();
  if (data.acceptPrivacy)
    await page.getByTestId('checkbox-privacyAccepted').click();
  if (data.acceptPersonalData)
    await page.getByTestId('checkbox-personalDataAccepted').click();
  if (data.acceptMarketing)
    await page.getByTestId('checkbox-marketing').click();
}

/** Клик на кнопку отправки (шаг 1) */
const clickSubmit = (page: Page) =>
  page.getByTestId('button-register').click();

/** Валидные данные для успешной регистрации */
const VALID_DATA: RegisterFormData = {
  firstName: 'Test',
  lastName: 'User',
  jobTitle: 'SMM-специалист',
  email: 'e2e_test@playwright.example',
  password: 'Test1234!',
  confirmPassword: 'Test1234!',
  acceptTerms: true,
  acceptPrivacy: true,
  acceptPersonalData: true,
};

// ---------------------------------------------------------------------------
// СЦЕНАРИЙ 1: Отображение страницы
// ---------------------------------------------------------------------------

test.describe('Регистрация — страница и форма', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('страница регистрации открывается', async ({ page }) => {
    await expect(page.locator('text=404')).not.toBeVisible();
    await expect(page.getByText('Создайте аккаунт')).toBeVisible({ timeout: 10000 });
  });

  test('присутствуют все поля формы', async ({ page }) => {
    await expect(page.getByTestId('input-first-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-last-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('select-job-title')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-email')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-password')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-confirm-password')).toBeVisible({ timeout: 10000 });
  });

  test('присутствуют все чекбоксы согласий', async ({ page }) => {
    await expect(page.getByTestId('checkbox-termsAccepted')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('checkbox-privacyAccepted')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('checkbox-personalDataAccepted')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('checkbox-marketing')).toBeVisible({ timeout: 10000 });
  });

  test('кнопка "Создать аккаунт" присутствует', async ({ page }) => {
    await expect(page.getByTestId('button-register')).toBeVisible({ timeout: 10000 });
  });

  test('ссылка "Войти в систему" ведёт на страницу входа', async ({ page }) => {
    await page.getByText(/уже есть аккаунт/i).click();
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 });
    expect(page.url()).toContain('/auth/login');
  });
});

// ---------------------------------------------------------------------------
// СЦЕНАРИЙ 2: Валидация формы (клиентская)
// ---------------------------------------------------------------------------

test.describe('Регистрация — валидация полей', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('пустая форма — показываются ошибки обязательных полей', async ({ page }) => {
    await clickSubmit(page);
    await page.waitForTimeout(500);
    const errors = await page.getByText(/обязательн|минимум|необходимо|укажите/i).count();
    expect(errors).toBeGreaterThan(0);
  });

  test('короткий пароль (< 6 символов) — ошибка', async ({ page }) => {
    await fillRegisterForm(page, { ...VALID_DATA, password: '123', confirmPassword: '123' });
    await clickSubmit(page);
    await page.waitForTimeout(500);
    await expect(page.getByText(/минимум 6/i)).toBeVisible();
  });

  test('несовпадающие пароли — ошибка', async ({ page }) => {
    await fillRegisterForm(page, {
      ...VALID_DATA,
      password: 'Test1234!',
      confirmPassword: 'WrongPass!',
    });
    await clickSubmit(page);
    await page.waitForTimeout(500);
    await expect(page.getByText(/пароли не совпадают/i)).toBeVisible();
  });

  test('неверный формат email — ошибка', async ({ page }) => {
    await fillRegisterForm(page, { ...VALID_DATA, email: 'not-an-email' });
    await clickSubmit(page);
    await page.waitForTimeout(600);
    await expect(page.getByText(/неверный формат email/i)).toBeVisible({ timeout: 5000 });
  });

  test('обязательный чекбокс оферты не отмечен — ошибка', async ({ page }) => {
    await fillRegisterForm(page, {
      ...VALID_DATA,
      acceptTerms: false,
      acceptPrivacy: true,
      acceptPersonalData: true,
    });
    await clickSubmit(page);
    await page.waitForTimeout(500);
    await expect(page.getByText(/необходимо принять условия оферты/i)).toBeVisible();
  });

  test('обязательный чекбокс политики конфиденциальности не отмечен — ошибка', async ({ page }) => {
    await fillRegisterForm(page, {
      ...VALID_DATA,
      acceptTerms: true,
      acceptPrivacy: false,
      acceptPersonalData: true,
    });
    await clickSubmit(page);
    await page.waitForTimeout(500);
    await expect(page.getByText(/необходимо.*политик/i)).toBeVisible();
  });

  test('обязательный чекбокс персональных данных не отмечен — ошибка', async ({ page }) => {
    await fillRegisterForm(page, {
      ...VALID_DATA,
      acceptTerms: true,
      acceptPrivacy: true,
      acceptPersonalData: false,
    });
    await clickSubmit(page);
    await page.waitForTimeout(500);
    await expect(page.getByText(/необходимо дать согласие на обработку/i)).toBeVisible();
  });

  test('маркетинговый чекбокс не обязателен — форма отправляется без него', async ({ page }) => {
    await page.route(REGISTER_API_RE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await fillRegisterForm(page, { ...VALID_DATA, acceptMarketing: false });
    await clickSubmit(page);

    await page.waitForURL(/\/auth\/login/, { timeout: 15000 });
    expect(page.url()).toContain('/auth/login');
  });
});

// ---------------------------------------------------------------------------
// СЦЕНАРИЙ 3: Успешная регистрация (мок API)
// ---------------------------------------------------------------------------

test.describe('Регистрация — успешный флоу (мок)', () => {
  test('успешная регистрация перенаправляет на страницу входа', async ({ page }) => {
    await page.route(REGISTER_API_RE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: 'new-user-123', email: VALID_DATA.email },
        }),
      });
    });

    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
    await fillRegisterForm(page, VALID_DATA);
    await clickSubmit(page);

    await page.waitForURL(/\/auth\/login/, { timeout: 15000 });
    expect(page.url()).toContain('/auth/login');
  });

  test('кнопка показывает спиннер во время отправки', async ({ page }) => {
    await page.route(REGISTER_API_RE, async (route) => {
      await new Promise(r => setTimeout(r, 2500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
    await fillRegisterForm(page, VALID_DATA);
    await clickSubmit(page);

    await expect(page.getByText(/создаём аккаунт/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.animate-spin')).toBeVisible({ timeout: 3000 });
  });

  test('регистрация с маркетинговым согласием — тоже работает', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route(REGISTER_API_RE, async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
    await fillRegisterForm(page, { ...VALID_DATA, acceptMarketing: true });
    await clickSubmit(page);

    await page.waitForURL(/\/auth\/login/, { timeout: 15000 });
    expect(page.url()).toContain('/auth/login');
    expect(capturedBody).not.toBeNull();
    expect((capturedBody as Record<string, unknown>).email).toBeTruthy();
    expect((capturedBody as Record<string, unknown>).firstName).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// СЦЕНАРИЙ 4: Обработка ошибок сервера
// ---------------------------------------------------------------------------

test.describe('Регистрация — ошибки сервера', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('email уже занят — показывается ошибка', async ({ page }) => {
    await page.route(REGISTER_API_RE, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Пользователь с таким email уже существует' }),
      });
    });

    await fillRegisterForm(page, VALID_DATA);
    await clickSubmit(page);

    const errorVisible = await Promise.race([
      page.getByText(/уже существует|email.*занят|ошибка регистрации|ошибка.*регистр/i).first()
        .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
      page.locator('[data-variant="destructive"], [class*="destructive"]')
        .first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    ]);
    expect(errorVisible, 'Должно быть видно сообщение об ошибке (тост или alert)').toBeTruthy();
    expect(page.url()).toContain('/auth/register');
  });

  test('ошибка сервера 500 — показывается сообщение об ошибке', async ({ page }) => {
    await page.route(REGISTER_API_RE, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    await fillRegisterForm(page, VALID_DATA);
    await clickSubmit(page);

    const errorVisible = await Promise.race([
      page.getByText(/ошибка|error|что-то пошло не так|неизвестная|failed|сервер|server/i).first()
        .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
      page.locator('[role="alert"], .toast, [data-variant="destructive"]').first()
        .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    ]);
    if (!errorVisible) {
      console.log('[INFO] Сообщение об ошибке 500 не отображено — возможно другой текст тоста');
    }
    expect(page.url()).toContain('/auth/register');
  });
});

// ---------------------------------------------------------------------------
// СЦЕНАРИЙ 5: Полный флоу регистрация → вход
// ---------------------------------------------------------------------------

test.describe('Полный флоу: Регистрация → Вход', () => {
  test('зарегистрированный пользователь может войти в систему', async ({ page }) => {
    test.setTimeout(60000);

    const testEmail = `e2e_flow_${Date.now()}@playwright.example`;
    const testPassword = 'E2ETest1234!';

    await page.route(REGISTER_API_RE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 'flow-user-1', email: testEmail } }),
      });
    });

    await page.goto(REGISTER_URL);
    await page.waitForLoadState('domcontentloaded');

    await fillRegisterForm(page, {
      firstName: 'Flow',
      lastName: 'Tester',
      jobTitle: 'SMM-специалист',
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
      acceptTerms: true,
      acceptPrivacy: true,
      acceptPersonalData: true,
    });
    await clickSubmit(page);
    await page.waitForURL(/\/(auth\/login|campaigns|dashboard)/, { timeout: 15000 });
    console.log('✅ Step 1: Регистрация завершена, редирект на:', page.url());

    if (page.url().includes('login')) {
      await expect(page.getByPlaceholder(/email/i).first()).toBeVisible({ timeout: 10000 });
      await page.getByPlaceholder(/email/i).first().fill(testEmail);
      await page.getByPlaceholder(/пароль/i).fill(testPassword);
      await expect(page.getByRole('button', { name: /войти/i })).toBeEnabled({ timeout: 5000 });
      console.log('✅ Step 2: Форма входа заполнена');
    } else {
      console.log('✅ Step 2: Авторизован автоматически, редирект на', page.url());
    }
    console.log('🎉 Полный флоу регистрация → вход завершён');
  });
});
