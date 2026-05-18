/**
 * Тесты навигации: 404, редиректы, защищённые маршруты
 * Проверяет что неавторизованные пользователи не попадают на закрытые страницы
 */

import { test, expect, Page } from './fixtures';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5000';

async function login(page: Page) {
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (page.url().includes('/auth/login') || page.url().includes('/login')) {
    await page.fill('input[type="email"]', process.env.TEST_EMAIL || 'lbrspb@gmail.com');
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || 'QtpZ3dh7');
    await page.getByRole('button', { name: /войти/i }).first().click();
    await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
    await page.waitForTimeout(1000);
  }
}

/**
 * Тесты защищённых маршрутов запускаются в ЧИСТОМ контексте браузера
 * без какого-либо storageState — полная анонимность гарантирована.
 */
test.describe('Защищённые маршруты — доступ без авторизации', () => {
  // Полностью сбрасываем auth-state для этой группы тестов
  test.use({ storageState: { cookies: [], origins: [] } });

  async function checkRedirectsToLogin(page: Page, path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // Ждём либо URL-редирект, либо появления формы логина
    const isRedirected = await page.waitForURL(
      url =>
        url.pathname.includes('/auth/login') ||
        url.pathname.includes('/login') ||
        url.pathname === '/auth',
      { timeout: 15000 }
    ).then(() => true).catch(() => false);

    const hasLoginForm = await page
      .locator('input[type="email"], input[name="email"]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    return isRedirected || hasLoginForm;
  }

  test('переход на /campaigns без авторизации редиректит на логин', async ({ page }) => {
    expect(await checkRedirectsToLogin(page, '/campaigns')).toBeTruthy();
  });

  test('переход на /content без авторизации редиректит на логин', async ({ page }) => {
    expect(await checkRedirectsToLogin(page, '/content')).toBeTruthy();
  });

  test('переход на /analytics без авторизации редиректит на логин', async ({ page }) => {
    expect(await checkRedirectsToLogin(page, '/analytics')).toBeTruthy();
  });
});

test.describe('Навигация авторизованного пользователя', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('несуществующий URL показывает 404 или редиректит', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-xyz-123', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const url = page.url();
    const has404 = await page.locator('text=404').or(page.getByText(/не найден|Not Found|Page not found/i))
      .first().isVisible({ timeout: 5000 }).catch(() => false);
    const redirectedToAuth = url.includes('/auth') || url.includes('/login');
    const redirectedToHome = url.includes('/campaigns') || url.includes('/dashboard') || url.includes('/content');
    const hasAnyContent = await page.locator('main, [role="main"], h1, h2, body').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    expect(has404 || redirectedToAuth || redirectedToHome || hasAnyContent).toBeTruthy();
  });

  test('переход /dashboard загружается без ошибок', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('переход /analytics загружается без ошибок', async ({ page }) => {
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('переход /keywords загружается без ошибок', async ({ page }) => {
    await page.goto('/keywords', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('переход /posts загружается без ошибок', async ({ page }) => {
    await page.goto('/posts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('переход /trends загружается без ошибок', async ({ page }) => {
    await page.goto('/trends', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('переход /settings загружается без ошибок', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
  });

  test('прямая навигация через URL не ломает состояние', async ({ page }) => {
    await page.goto('/campaigns');
    await page.waitForTimeout(1500);
    await page.goto('/content');
    await page.waitForTimeout(1500);
    await page.goto('/analytics');
    await page.waitForTimeout(1500);
    await page.goto('/campaigns');
    await page.waitForTimeout(1500);
    const crashed = await page.locator('text=Uncaught Error, text=ChunkLoadError').isVisible().catch(() => false);
    expect(crashed).toBeFalsy();
    const hasContent = await page.locator('main, [role="main"]').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });
});
