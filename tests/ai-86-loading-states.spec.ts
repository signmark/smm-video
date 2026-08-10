import { test, expect, Page } from '@playwright/test';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

/**
 * AI-86: каркас страницы появляется сразу, плейсхолдер только в области данных,
 * счётчик не показывает 0 до ответа.
 *
 * Ответ API намеренно ЗАДЕРЖИВАЕТСЯ: на быстром соединении этот класс дефектов
 * не виден вообще -- данные успевают прийти раньше, чем можно разглядеть
 * состояние загрузки. Владелец жаловался именно на медленный интернет.
 */

const CAMPAIGN_ID = '11111111-2222-4333-8444-555555555555';
const DELAY_MS = 4000;

async function openScheduledSlow(page: Page, payload: unknown): Promise<void> {
  await page.addInitScript((id) => {
    localStorage.setItem('selected_campaign_id', id as string);
    localStorage.setItem('selected_campaign_name', 'E2E кампания');
  }, CAMPAIGN_ID);

  await page.route('**/api/user/profile*', async (route) => {
    const r = await route.fetch();
    let b: Record<string, unknown> = {};
    try { b = await r.json(); } catch { b = {}; }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...b, plan: 'pro', expire_date: null }) });
  });
  await page.route('**/api/campaigns*', (r) => r.fulfill({ status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: CAMPAIGN_ID, name: 'E2E кампания' }]) }));

  // Медленный ответ -- главное в этой спеке.
  await page.route('**/api/campaign-content*', async (route) => {
    await new Promise((res) => setTimeout(res, DELAY_MS));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(payload) });
  });

  await page.goto('/publish/scheduled');
  await dismissCookieBanner(page);
  const banner = page.getByTestId('cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('cookie-accept-all').click();
  }
}

test.describe('AI-86: состояния загрузки на медленной сети', () => {
  test('каркас страницы виден ДО ответа API', async ({ page }) => {
    await openScheduledSlow(page, { data: [] });
    // Заголовок раздела должен быть на месте, пока данные ещё едут.
    await expect(page.getByText('Запланированные публикации').first()).toBeVisible({ timeout: 3000 });
  });

  test('счётчик не показывает 0, пока ответ не пришёл', async ({ page }) => {
    await openScheduledSlow(page, { data: [] });
    await page.waitForTimeout(1500); // ответ ещё в пути
    const body = await page.locator('body').innerText();
    const claimsZero = /Предстоящие публикации\s*0/.test(body.replace(/\s+/g, ' '));
    expect(claimsZero, 'счётчик утверждает «0», хотя ответа ещё нет').toBe(false);
  });

  test('после ответа с нулём записей нет скелетонов', async ({ page }) => {
    await openScheduledSlow(page, { data: [] });
    await page.waitForTimeout(DELAY_MS + 2000);
    const skeletons = page.locator('.animate-pulse');
    expect(await skeletons.count(), 'скелетоны остались при нуле записей').toBe(0);
  });
});
