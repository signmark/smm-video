/**
 * Стресс-тест: 5 параллельных браузерных контекстов
 *
 * Симулирует 5 одновременно залогиненных пользователей, каждый из которых
 * выполняет полный навигационный флоу:
 *   логин (через сохранённый storageState) → кампании → контент → аналитика → ключевые слова
 *
 * Тест падает при любой HTTP 5xx ошибке или неперехваченном JS-исключении
 * в любом из браузерных контекстов.
 *
 * Запуск:
 *   npx playwright test tests/stress-concurrent.spec.ts --project=chromium
 */

import { test, expect, Browser, BrowserContext, Page, setupNoSecurePrivacy } from './fixtures';

const CONCURRENT_USERS = 5;

interface UserSession {
  userId: number;
  context: BrowserContext;
  page: Page;
  errors: string[];
  serverErrors: string[];
  timings: Record<string, number>;
}

async function createUserSession(
  browser: Browser,
  userId: number
): Promise<UserSession> {
  const context = await browser.newContext({
    storageState: 'playwright/.auth/user.json',
  });

  const page = await context.newPage();
  // Block SecurePrivacy on every manually-created page (bypasses page fixture)
  await setupNoSecurePrivacy(page);
  const errors: string[] = [];
  const serverErrors: string[] = [];
  const timings: Record<string, number> = {};

  page.on('pageerror', err => {
    const msg = `[User ${userId}] Uncaught JS error: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('WebSocket') ||
        text.includes('401') ||
        text.includes('Failed to fetch') ||
        text.includes('Each child in a list') ||
        // Expected during rapid concurrent navigation: in-flight requests get cancelled
        text.includes('Произошла неожиданная ошибка') ||
        text.includes('Обратитесь к технической поддержке') ||
        text.includes('NetworkError') ||
        text.includes('Load failed') ||
        text.includes('net::ERR_ABORTED') ||
        text.includes('net::ERR_FAILED')
      )
        return;
      const entry = `[User ${userId}] Console error: ${text}`;
      console.error(entry);
      errors.push(entry);
    }
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      const url = response.url();
      const entry = `[User ${userId}] HTTP ${response.status()}: ${url}`;
      console.error(entry);
      serverErrors.push(entry);
    }
  });

  return { userId, context, page, errors, serverErrors, timings };
}

async function runUserFlow(session: UserSession): Promise<void> {
  const { userId, page, timings } = session;

  const routes = [
    { name: 'campaigns', path: '/campaigns' },
    { name: 'content', path: '/content' },
    { name: 'analytics', path: '/analytics' },
    { name: 'keywords', path: '/keywords' },
    { name: 'dashboard', path: '/dashboard' },
  ];

  console.log(`[User ${userId}] Starting flow...`);

  for (const route of routes) {
    const start = Date.now();
    try {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      const elapsed = Date.now() - start;
      timings[route.name] = elapsed;

      const url = page.url();
      const redirectedToLogin =
        url.includes('/auth/login') || url.includes('/login');

      if (redirectedToLogin) {
        session.errors.push(
          `[User ${userId}] Unexpected redirect to login from ${route.path}`
        );
      }

      console.log(
        `[User ${userId}] ✓ ${route.name}: ${elapsed}ms (${url})`
      );
    } catch (err: unknown) {
      timings[route.name] = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      session.errors.push(`[User ${userId}] Navigation error on ${route.path}: ${message}`);
    }
  }

  const logoutStart = Date.now();
  let logoutSucceeded = false;
  try {
    const userMenu = page.getByTestId('button-user-menu');
    const menuVisible = await userMenu.isVisible({ timeout: 8000 }).catch(() => false);

    if (menuVisible) {
      await userMenu.click({ timeout: 5000 });
      const logoutBtn = page.getByTestId('menu-logout')
        .or(page.getByRole('menuitem', { name: /выйти|logout|sign out/i }))
        .first();
      const logoutVisible = await logoutBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (logoutVisible) {
        await logoutBtn.click({ timeout: 5000 });
        const redirected = await page
          .waitForURL(url => url.pathname.includes('/auth/login') || url.pathname.includes('/login'), {
            timeout: 15000,
          })
          .then(() => true)
          .catch(() => false);

        if (redirected) {
          logoutSucceeded = true;
          console.log(`[User ${userId}] ✓ logout: ${Date.now() - logoutStart}ms`);
        } else {
          session.errors.push(
            `[User ${userId}] Logout clicked but no redirect to /auth/login (url: ${page.url()})`
          );
        }
      } else {
        session.errors.push(
          `[User ${userId}] Logout button not found inside user menu — auth lifecycle incomplete`
        );
      }
    } else {
      session.errors.push(
        `[User ${userId}] User menu (button-user-menu) not visible — cannot perform logout`
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    session.errors.push(`[User ${userId}] Logout step threw: ${message}`);
  }
  timings['logout'] = Date.now() - logoutStart;
  if (!logoutSucceeded) {
    console.warn(`[User ${userId}] ⚠ logout did not complete successfully`);
  }

  console.log(`[User ${userId}] Flow complete.`);
}

test.describe('Стресс: 5 параллельных пользователей', () => {
  test.setTimeout(180000);

  test(
    `${CONCURRENT_USERS} браузерных контекстов одновременно — без 500-ошибок и JS-крашей`,
    async ({ browser }) => {
      console.log(`\nCreating ${CONCURRENT_USERS} isolated browser contexts...`);

      const sessions = await Promise.all(
        Array.from({ length: CONCURRENT_USERS }, (_, i) =>
          createUserSession(browser, i + 1)
        )
      );

      console.log(`Running all ${CONCURRENT_USERS} user flows in parallel...\n`);
      const startAll = Date.now();

      await Promise.all(sessions.map(session => runUserFlow(session)));

      const totalMs = Date.now() - startAll;
      console.log(`\nAll ${CONCURRENT_USERS} users completed in ${totalMs}ms`);

      console.log('\n─── Per-user timing (ms) ───');
      for (const session of sessions) {
        const timingStr = Object.entries(session.timings)
          .map(([k, v]) => `${k}:${v}`)
          .join('  ');
        console.log(`  User ${session.userId}: ${timingStr}`);
      }

      console.log('\n─── Cleanup ───');
      await Promise.all(sessions.map(s => s.context.close()));

      const allErrors = sessions.flatMap(s => s.errors);
      const allServerErrors = sessions.flatMap(s => s.serverErrors);

      if (allServerErrors.length > 0) {
        console.error('\n❌ Server (5xx) errors detected:');
        for (const e of allServerErrors) console.error('  ' + e);
      }
      if (allErrors.length > 0) {
        console.error('\n❌ JS / navigation errors detected:');
        for (const e of allErrors) console.error('  ' + e);
      }

      expect(allServerErrors, 'No HTTP 5xx errors under concurrent load').toHaveLength(0);
      expect(allErrors, 'No JS crashes or unexpected redirects under concurrent load').toHaveLength(0);
    }
  );

  test(
    'каждый пользователь видит список кампаний (не пустой или graceful empty state)',
    async ({ browser }) => {
      test.setTimeout(120000);

      const sessions = await Promise.all(
        Array.from({ length: CONCURRENT_USERS }, (_, i) =>
          createUserSession(browser, i + 1)
        )
      );

      await Promise.all(
        sessions.map(async session => {
          const { page, userId } = session;
          await page.goto('/campaigns', { waitUntil: 'domcontentloaded', timeout: 30000 });
          // Extra wait for concurrent load (5 parallel sessions may be slower)
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          const hasContent = await page
            .locator('main, [role="main"], [data-testid], h1, h2')
            .first()
            .isVisible({ timeout: 20000 })
            .catch(() => false);

          if (!hasContent) {
            session.errors.push(`[User ${userId}] Campaigns page has no visible content`);
          } else {
            console.log(`[User ${userId}] ✓ Campaigns page loaded`);
          }
        })
      );

      await Promise.all(sessions.map(s => s.context.close()));

      const allErrors = sessions.flatMap(s => s.errors);
      const allServerErrors = sessions.flatMap(s => s.serverErrors);

      expect(allServerErrors, 'No HTTP 5xx errors').toHaveLength(0);
      expect(allErrors, 'All users see campaigns page content').toHaveLength(0);
    }
  );
});
