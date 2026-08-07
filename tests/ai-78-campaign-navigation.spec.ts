import { test, expect, Page } from '@playwright/test';
import { dismissCookieBanner } from './helpers/dismiss-cookie-banner';

/**
 * AI-78: после создания кампании через ИИ-чат должно перекидывать на страницу
 * этой кампании.
 *
 * Зачем спека в браузере, если есть модульные тесты. Модульный тест проверяет
 * хелпер, который выбирает id, но не проверяет, что чат действительно
 * переходит: между ними живой компонент, роутер и задержка. Именно этот стык и
 * был сломан — причём молча, и заметил это владелец, а не мы.
 *
 * Ответ сервера здесь подменяется намеренно. Гонять живую модель ради проверки
 * навигации дорого и ненадёжно (формулировка каждый раз разная — а вся суть
 * правки в том, что формулировка больше ни на что не влияет). Поэтому отдаём
 * структурный ответ БЕЗ каких-либо опознавательных строк в тексте: на старом
 * коде спека упала бы, потому что переходить было бы не от чего.
 */

const TEST_CREDENTIALS = {
  email: process.env.TEST_EMAIL || process.env.ADMIN_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || '',
  password: process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

const CAMPAIGN_ID = '0e2f7a11-4c3d-4b8e-9a10-5f6d7c8b9a01';

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  if (/\/(auth\/)?login/.test(page.url())) {
    await page.getByPlaceholder(/email|электронная почта/i)
      .or(page.locator('input[type="email"]'))
      .fill(TEST_CREDENTIALS.email);
    await page.locator('input[type="password"]').fill(TEST_CREDENTIALS.password);
    await page.getByRole('button', { name: /войти|sign in/i }).first().click();
    await page.waitForURL(/\/(dashboard|campaigns)/, { timeout: 30000 });
  }
}

/**
 * Чат открывается кнопкой в топбаре (`button-ai-assistant`). Плавающая кнопка
 * `button-open-ai-chat` живёт внутри самого AIChat и на рабочих страницах не
 * отрисована — на неё я сначала и нацелился, спека падала не по делу.
 */
async function openChat(page: Page): Promise<void> {
  // Общий хелпер снимает только сторонний оверлей Secure Privacy (#sp-*).
  // Перехватывает клики НАШ собственный баннер (data-testid="cookie-banner"),
  // поэтому его надо именно принять, а не удалить.
  await dismissCookieBanner(page);
  const banner = page.getByTestId('cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('cookie-accept-all').click();
    await expect(banner).toBeHidden({ timeout: 10000 });
  }
  await page.getByTestId('button-ai-assistant').click();
  await expect(page.getByTestId('input-ai-chat-message')).toBeVisible({ timeout: 10000 });
}

/** Ответ без единой строки, по которой можно было бы догадаться об id из текста. */
function stubCreateCampaign(page: Page, body: Record<string, unknown>) {
  return page.route('**/api/ai-assistant/process-command', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('AI-78: переход после создания кампании через ИИ-чат', () => {
  test('переходит на страницу кампании, когда id пришёл структурно', async ({ page }) => {
    await ensureLoggedIn(page);

    await stubCreateCampaign(page, {
      success: true,
      action: 'Создана кампания "Проверочная"',
      response: 'Готово.',
      campaignId: CAMPAIGN_ID,
    });

    await openChat(page);
    await page.getByTestId('input-ai-chat-message').fill('создай кампанию Проверочная');
    await page.getByTestId('button-send-ai-message').click();

    // Клиент ждёт 2 секунды перед переходом, поэтому запас времени.
    await page.waitForURL(new RegExp(`/campaigns/${CAMPAIGN_ID}`), { timeout: 20000 });
    expect(page.url()).toContain(`/campaigns/${CAMPAIGN_ID}`);
  });

  test('текст ответа на переход не влияет', async ({ page }) => {
    await ensureLoggedIn(page);

    // Ни «создана», ни ID в тексте — на старом коде это гарантированно не сработало бы.
    await stubCreateCampaign(page, {
      success: true,
      action: 'Создана кампания "Вторая"',
      response: 'Campaign is ready.',
      data: { campaignId: CAMPAIGN_ID },
    });

    await openChat(page);
    await page.getByTestId('input-ai-chat-message').fill('создай кампанию Вторая');
    await page.getByTestId('button-send-ai-message').click();

    await page.waitForURL(new RegExp(`/campaigns/${CAMPAIGN_ID}`), { timeout: 20000 });
    expect(page.url()).toContain(`/campaigns/${CAMPAIGN_ID}`);
  });

  test('без структурного id никуда не уводит', async ({ page }) => {
    await ensureLoggedIn(page);
    const before = page.url();

    // id есть только в тексте — намеренно: текст больше не источник данных.
    await stubCreateCampaign(page, {
      success: true,
      action: 'Создана кампания "Третья"',
      response: `✅ Кампания создана! 📊 **ID:** ${CAMPAIGN_ID}`,
    });

    await openChat(page);
    await page.getByTestId('input-ai-chat-message').fill('создай кампанию Третья');
    await page.getByTestId('button-send-ai-message').click();

    await page.waitForTimeout(6000);
    expect(page.url()).not.toContain(`/campaigns/${CAMPAIGN_ID}`);
    expect(page.url()).toBe(before);
  });
});
