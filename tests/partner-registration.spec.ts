/**
 * Playwright E2E тесты: партнёрская регистрация (?ref=CODE)
 *
 * Покрывают:
 *   R01  ?ref= сохраняется в localStorage до редиректа AuthGuard
 *   R02  код нормализуется в UPPER_CASE
 *   R03  партнёрский код уходит в тело POST /api/auth/register
 *   R04  регистрация БЕЗ ?ref= — partnerCode в теле отсутствует
 *   R05  после успешной регистрации smm_partner_code удаляется из localStorage
 *   R06  ?ref= с пробелами обрезается (trim)
 *   R07  localStorage сохраняется при SPA-навигации с главной на /auth/register
 *
 * Запуск:
 *   npx playwright test partner-registration --project=chromium
 */

import { test, expect, type Page } from './fixtures';

test.use({ storageState: { cookies: [], origins: [] } });

const REGISTER_API_RE = /\/api\/auth\/register/;

// ---------------------------------------------------------------------------
// Хелперы
// ---------------------------------------------------------------------------

/** Заполняет все обязательные поля формы регистрации */
async function fillForm(page: Page) {
  await page.getByTestId('input-first-name').fill('Тест');
  await page.getByTestId('input-last-name').fill('Партнёр');

  // jobTitle — обязательный select
  await page.getByTestId('select-job-title').click();
  await page.waitForSelector('[role="option"]', { timeout: 5000 }).catch(() => {});
  const firstOption = page.getByRole('option').first();
  if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstOption.click();
  } else {
    await page.keyboard.press('Escape');
  }

  await page.getByTestId('input-email').fill(`p_${Date.now()}@test.example`);
  await page.getByTestId('input-password').fill('Test1234!');
  await page.getByTestId('input-confirm-password').fill('Test1234!');
  await page.getByTestId('checkbox-termsAccepted').click();
  await page.getByTestId('checkbox-privacyAccepted').click();
  await page.getByTestId('checkbox-personalDataAccepted').click();
}

/** Мок успешной регистрации (201 + userId + token) */
async function mockRegisterOk(page: Page) {
  await page.route(REGISTER_API_RE, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'test-partner-user-id',
        token: 'fake-token',
        refresh_token: 'fake-refresh',
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// R01: ?ref= сохраняется в localStorage СРАЗУ — до любого редиректа
// ---------------------------------------------------------------------------

test('R01 ?ref=CODE сохраняется в localStorage до редиректа AuthGuard', async ({ page }) => {
  await page.route('/api/**', (route) => route.fulfill({ status: 200, body: '{}' }));

  await page.goto('/?ref=TESTPARTNER001');
  await page.waitForLoadState('domcontentloaded');

  const stored = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(stored).toBe('TESTPARTNER001');
});

// ---------------------------------------------------------------------------
// R02: нормализация кода в UPPER_CASE
// ---------------------------------------------------------------------------

test('R02 ?ref= нормализуется в UPPER_CASE', async ({ page }) => {
  await page.route('/api/**', (route) => route.fulfill({ status: 200, body: '{}' }));

  await page.goto('/?ref=lowercase_code');
  await page.waitForLoadState('domcontentloaded');

  const stored = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(stored).toBe('LOWERCASE_CODE');
});

// ---------------------------------------------------------------------------
// R03: партнёрский код уходит в тело запроса регистрации
// ---------------------------------------------------------------------------

test('R03 partnerCode попадает в тело POST /api/auth/register', async ({ page }) => {
  let capturedBody: Record<string, unknown> | null = null;

  await page.route(REGISTER_API_RE, async (route) => {
    capturedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ userId: 'u1', token: 'tok' }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('smm_partner_code', 'REFPARTNER42');
  });

  await page.goto('/auth/register');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await fillForm(page);
  await page.getByTestId('button-register').click();

  await page.waitForResponse(REGISTER_API_RE, { timeout: 10000 }).catch(() => {});

  expect(capturedBody, 'Запрос регистрации должен быть перехвачен').not.toBeNull();
  expect((capturedBody as Record<string, unknown>).partnerCode).toBe('REFPARTNER42');
});

// ---------------------------------------------------------------------------
// R04: без ?ref= → partnerCode отсутствует в теле
// ---------------------------------------------------------------------------

test('R04 регистрация БЕЗ ?ref= — partnerCode НЕ попадает в тело запроса', async ({ page }) => {
  let capturedBody: Record<string, unknown> | null = null;

  await page.route(REGISTER_API_RE, async (route) => {
    capturedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ userId: 'u2', token: 'tok2' }),
    });
  });

  await page.addInitScript(() => {
    localStorage.removeItem('smm_partner_code');
  });

  await page.goto('/auth/register');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await fillForm(page);
  await page.getByTestId('button-register').click();

  await page.waitForResponse(REGISTER_API_RE, { timeout: 10000 }).catch(() => {});

  expect(capturedBody, 'Запрос должен быть перехвачен').not.toBeNull();
  const body = capturedBody as Record<string, unknown>;
  expect(body.partnerCode == null || body.partnerCode === '').toBeTruthy();
});

// ---------------------------------------------------------------------------
// R05: после успешной регистрации localStorage очищается
// ---------------------------------------------------------------------------

test('R05 smm_partner_code удаляется из localStorage после успешной регистрации', async ({ page }) => {
  await mockRegisterOk(page);

  await page.addInitScript(() => {
    localStorage.setItem('smm_partner_code', 'TOCLEAN');
  });

  await page.goto('/auth/register');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await fillForm(page);
  await page.getByTestId('button-register').click();

  // Ждём отправки запроса и реакции компонента
  await page.waitForResponse(REGISTER_API_RE, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const stored = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(stored).toBeNull();
});

// ---------------------------------------------------------------------------
// R06: ?ref= с пробелами — обрезается (trim)
// ---------------------------------------------------------------------------

test('R06 ?ref= с пробелами обрезается (trim)', async ({ page }) => {
  await page.route('/api/**', (route) => route.fulfill({ status: 200, body: '{}' }));

  await page.goto('/?ref=%20SPACED%20');
  await page.waitForLoadState('domcontentloaded');

  const stored = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(stored).toBe('SPACED');
});

// ---------------------------------------------------------------------------
// R07: SPA-навигация — код сохраняется при переходе с / на /auth/register
// ---------------------------------------------------------------------------

test('R07 SPA-навигация: smm_partner_code доступен на /auth/register после ?ref= на /', async ({ page }) => {
  await page.route('/api/**', (route) => route.fulfill({ status: 200, body: '{}' }));

  await page.goto('/?ref=NAVTEST');
  await page.waitForLoadState('domcontentloaded');

  const storedAtRoot = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(storedAtRoot).toBe('NAVTEST');

  // SPA-навигация на страницу регистрации
  await page.goto('/auth/register');
  await page.waitForLoadState('domcontentloaded');

  const storedAtRegister = await page.evaluate(() => localStorage.getItem('smm_partner_code'));
  expect(storedAtRegister).toBe('NAVTEST');
});
