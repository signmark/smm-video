import { test, expect, Page } from '@playwright/test';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

/**
 * AI-81: в аналитике рядом с метриками кампании должны стоять метрики канала.
 *
 * Ответ API подменяется: живых кампаний с нужным расхождением на стенде нет, а
 * проверяем мы здесь отрисовку, а не расчёт (расчёт закрыт модульным тестом
 * server/__tests__/analytics-channel-vs-campaign.test.ts).
 */

const CAMPAIGN_ID = '11111111-2222-4333-8444-555555555555';

async function openAnalytics(page: Page, payload: unknown): Promise<void> {
  // Без выбранной кампании страница не запрашивает аналитику вовсе и рисует
  // «Аналитика недоступна» — выбор кампании хранится в localStorage, там же
  // его и ставим, чтобы не кликать по селектору.
  await page.addInitScript((id) => {
    localStorage.setItem('selected_campaign_id', id);
    localStorage.setItem('selected_campaign_name', 'E2E кампания');
  }, CAMPAIGN_ID);

  // Раздел аналитики закрыт тарифом: на стенде админ сидит на «Базовом» и
  // видит заглушку про Pro вместо карточек. Подменяем профиль, иначе проверять
  // отрисовку не на чем.
  await page.route('**/api/user/profile*', async (route) => {
    const response = await route.fetch();
    let body: Record<string, unknown> = {};
    try { body = await response.json(); } catch { body = {}; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, plan: 'pro', expire_date: null }),
    });
  });

  await page.route('**/api/campaigns*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: CAMPAIGN_ID, name: 'E2E кампания' }]),
    });
  });
  await page.route('**/api/analytics/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/analytics');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookieBanner(page);
  const banner = page.getByTestId('cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('cookie-accept-all').click();
    await expect(banner).toBeHidden({ timeout: 10000 });
  }
}

const BASE = {
  success: true,
  totalPosts: 3,
  totalViews: 30,
  totalLikes: 3,
  totalShares: 0,
  totalComments: 0,
};

test.describe('AI-81: метрики кампании и канала рядом', () => {
  test('при расхождении показывает вторую цифру', async ({ page }) => {
    await openAnalytics(page, {
      ...BASE,
      platforms: [{
        name: 'telegram',
        posts: 3, views: 30, likes: 3, shares: 0, comments: 0,
        channelTotals: { posts: 4, views: 42, likes: 4, shares: 0, comments: 0 },
      }],
    });

    // Расклад SM-15: по кампании 3 лайка, по каналу 4.
    const marks = page.getByTestId('channel-total');
    await expect(marks.first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('42')).toBeVisible();
    await expect(marks).toHaveCount(2); // просмотры и лайки различаются, репосты и комментарии нет
  });

  test('когда цифры совпадают, второй не появляется', async ({ page }) => {
    await openAnalytics(page, {
      ...BASE,
      platforms: [{
        name: 'telegram',
        posts: 3, views: 30, likes: 3, shares: 0, comments: 0,
        channelTotals: { posts: 3, views: 30, likes: 3, shares: 0, comments: 0 },
      }],
    });

    await expect(page.getByText('3').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('channel-total')).toHaveCount(0);
  });

  test('без channelTotals вторая цифра не выдумывается', async ({ page }) => {
    await openAnalytics(page, {
      ...BASE,
      platforms: [{ name: 'telegram', posts: 3, views: 30, likes: 3, shares: 0, comments: 0 }],
    });

    await expect(page.getByText('3').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('channel-total')).toHaveCount(0);
  });
});
