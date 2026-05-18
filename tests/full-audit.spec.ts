import { test, expect, Page } from './fixtures';

/**
 * "Stress Test" Bug Hunter
 * Обходит основные разделы, кликает по всем активным элементам,
 * мониторит консоль и сетевые ошибки.
 */

test.describe('Stress Test Bug Hunter', () => {
  const errors: string[] = [];
  const clickedElements = new Set<string>();

  test.beforeEach(async ({ page }) => {
    // Мониторинг консоли
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' || text.includes('Bad Decrypt') || text.includes('Error')) {
        // Игнорируем React key warnings и ошибки Failed to fetch (которые часто следствие net::ERR_ABORTED)
        if (text.includes('Each child in a list should have a unique "key" prop')) return;
        if (text.includes('TypeError: Failed to fetch')) return;
        if (text.includes('unexpected error') || text.includes('неожиданная ошибка')) return;
        // Игнорируем Vite HMR WebSocket ошибки (ожидаемо на продакшне без WebSocket)
        if (text.includes('WebSocket connection') || text.includes('WebSocket handshake')) return;
        // Игнорируем 401 ошибки авторизации (ожидаемо при истёкшем токене)
        if (text.includes('401') && (text.includes('auth') || text.includes('Failed to load resource'))) return;
        if (text.includes('Ошибка обновления токена')) return;
        
        console.error(`[BROWSER ERROR] ${text}`);
        errors.push(`Console Error: ${text} at ${page.url()}`);
      }
    });

    // Мониторинг необработанных исключений
    page.on('pageerror', err => {
      console.error(`[UNCAUGHT EXCEPTION] ${err.message}`);
      errors.push(`Page Error: ${err.message} at ${page.url()}`);
    });

    // Мониторинг сетевых ошибок
    page.on('requestfailed', request => {
      const failure = request.failure();
      const url = request.url();
      // Игнорируем ошибки net::ERR_ABORTED (навигация)
      if (failure?.errorText === 'net::ERR_ABORTED') return;
      // Игнорируем ошибки сторонних скриптов (не smm.omemo.tech)
      if (!url.includes('smm.omemo.tech') && !url.startsWith('/')) return;
      
      console.error(`[REQUEST FAILED] ${url} - ${failure?.errorText}`);
      errors.push(`Request Failed: ${url} - ${failure?.errorText}`);
    });

    page.on('response', response => {
      if (response.status() >= 400) {
        const url = response.url();
        // 401 на auth/refresh — ожидаемо при старте без сессии
        if (response.status() === 401 && url.includes('/auth/')) return;
        if (url.includes('favicon.ico') || url.includes('.png')) return;
        console.error(`[HTTP ERROR] ${response.status()} ${url}`);
        errors.push(`HTTP ${response.status()}: ${url}`);
      }
    });
  });

  async function clickAllButtons(page: Page) {
    console.log(`Scanning for buttons/links on ${page.url()}`);
    // Игнорируем кнопки в сайдбаре (nav[role="navigation"]), чтобы не уходить со страницы раньше времени
    const buttons = await page.locator('button:visible, a:visible').filter({ hasNot: page.locator('nav[role="navigation"]') }).all();
    console.log(`Found ${buttons.length} visible clickable elements (excluding sidebar)`);

    for (let i = 0; i < Math.min(buttons.length, 10); i++) { // Уменьшим до 10 кликов для скорости
      try {
        const btn = buttons[i];
        if (!await btn.isVisible()) continue;
        
        const text = await btn.innerText().catch(() => '');
        const id = await btn.getAttribute('id').catch(() => '') || text || `index-${i}`;
        
        if (!text && !id) continue;
        if (clickedElements.has(`${page.url()}-${id}`)) continue;
        
        console.log(`Clicking: "${text.trim()}" (${id})`);
        await btn.click({ timeout: 3000 }).catch(() => console.log(`Click failed for ${text}`));
        clickedElements.add(`${page.url()}-${id}`);
        await page.waitForTimeout(300); 
        
        if (errors.length > 0) {
          await page.screenshot({ path: `error-screenshot-${Date.now()}.png` });
          throw new Error(`Errors detected after clicking "${text}": ${errors[0]}`);
        }
      } catch (e) {
        console.log(`Skip element due to error: ${e.message}`);
      }
    }
  }

  test('Full Audit & Stress Click', async ({ page }) => {
    test.setTimeout(300000); // Аудит + опциональное создание кампании — до 5 минут
    // 1. Список кампаний
    console.log('--- Phase 1: Campaigns List ---');
    await page.goto('/campaigns');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await clickAllButtons(page);

    // 2. Создание кампании
    console.log('--- Phase 2: Create Campaign ---');
    const createBtn = page.getByTestId('button-open-create-campaign-dialog');
    if (await createBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await createBtn.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      
      const campaignName = `Stress Test ${Date.now()}`;
      await page.getByTestId('input-campaign-name').fill(campaignName);
      await page.getByTestId('input-campaign-website').fill('https://example.com');
      
      // Проверка логики чекбоксов
      await page.getByTestId('checkbox-auto-analyze').check();
      await page.getByTestId('checkbox-auto-fill-questionnaire').check();
      
      const submitBtn = page.getByRole('button', { name: /create now|создать|submit/i }).last();
      await submitBtn.click();
      
      // Ждем закрытия диалога
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 60000 });
      console.log('Campaign created successfully');
    }

    // 3. Аналитика
    console.log('--- Phase 3: Analytics ---');
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await clickAllButtons(page);

    // 4. Настройки
    console.log('--- Phase 4: Settings ---');
    await page.goto('/settings').catch(() => console.log('Settings page not found'));
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await clickAllButtons(page);

    // Проверка "Зеленой галочки" в деталях последней кампании
    console.log('--- Phase 5: Green Checkmark Logic ---');
    await page.goto('/campaigns');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    
    // Находим последнюю созданную кампанию (она должна быть первой в списке)
    const campaignCard = page.locator('a[href^="/campaigns/"]').first();
    if (await campaignCard.isVisible()) {
      await campaignCard.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      
      console.log('Checking for green checkmarks in Campaign Details...');
      
      // Проверяем "Бизнес-анкета"
      const questionnaireTrigger = page.locator('button[data-state]').filter({ hasText: /Бизнес-анкета/ });
      const questionnaireVisible = await questionnaireTrigger.isVisible({ timeout: 10000 }).catch(() => false);
      if (!questionnaireVisible) {
        console.log('[INFO] Триггер "Бизнес-анкета" не найден, пропускаем проверку галочки');
      } else {
      
      // Мы авто-заполнили анкету при создании, поэтому галочка ДОЛЖНА быть
      const checkmark = questionnaireTrigger.locator('.text-green-500');
      const isVisible = await checkmark.isVisible();
      
      if (!isVisible) {
        console.error('❌ FAIL: Questionnaire is filled but no green checkmark found!');
        await page.screenshot({ path: `missing-checkmark-${Date.now()}.png` });
        errors.push('Logic Error: Missing green checkmark on filled Questionnaire');
      } else {
        console.log('✅ Success: Green checkmark found on Questionnaire');
      }
      } // end else (questionnaireVisible)
    } // end if (campaignCard.isVisible())

    if (errors.length > 0) {
      throw new Error(`Stress test failed with ${errors.length} errors: \n${errors.join('\n')}`);
    }
    
    console.log('Stress test passed!');
  });
});
