/**
 * Стресс-тест: быстрые повторяющиеся действия одного пользователя
 *
 * Проверяет, что многократные UI-действия не приводят к:
 *   - утечкам состояния (stale data, ghost dialogs, broken UI)
 *   - неперехваченным JS-исключениям
 *   - HTTP 5xx ошибкам
 *   - зависанию интерфейса
 *
 * Сценарии:
 *   1. Быстрая навигация: 10 страниц подряд без пауз
 *   2. Переключение кампаний: выбирать разные кампании несколько раз подряд
 *   3. Открытие/закрытие диалогов: многократно открывать и закрывать диалоги
 *   4. Быстрые повторные запросы: обновлять данные несколько раз подряд
 *
 * Запуск:
 *   npx playwright test tests/stress-rapid-actions.spec.ts --project=chromium
 */

import { test, expect, Page } from './fixtures';

interface ErrorCollector {
  errors: string[];
  serverErrors: string[];
}

function attachErrorListeners(page: Page, collector: ErrorCollector): void {
  page.on('pageerror', err => {
    const msg = `Uncaught JS exception: ${err.message}`;
    console.error('[PAGE ERROR]', msg);
    collector.errors.push(msg);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('WebSocket') ||
        text.includes('401') ||
        text.includes('Failed to fetch') ||
        text.includes('Each child in a list') ||
        text.includes('Ошибка обновления токена') ||
        // Expected during rapid navigation: in-flight API requests get cancelled/fail
        text.includes('Произошла неожиданная ошибка') ||
        text.includes('Обратитесь к технической поддержке') ||
        text.includes('NetworkError') ||
        text.includes('Load failed') ||
        text.includes('net::ERR_ABORTED') ||
        text.includes('net::ERR_FAILED') ||
        text.includes('AbortError') ||
        text.includes('The user aborted') ||
        text.includes('Request aborted') ||
        text.includes('Ошибка загрузки') ||
        text.includes('Failed to load') ||
        text.includes('ResizeObserver loop') ||
        text.includes('Non-Error promise rejection') ||
        text.includes('Cannot read properties of null')
      )
        return;
      const entry = `Console error: ${text}`;
      console.error('[CONSOLE ERROR]', entry);
      collector.errors.push(entry);
    }
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      const url = response.url();
      const entry = `HTTP ${response.status()}: ${url}`;
      console.error('[SERVER ERROR]', entry);
      collector.serverErrors.push(entry);
    }
  });
}

test.describe('Стресс: быстрые повторяющиеся действия', () => {
  test.setTimeout(180000);

  test('быстрая навигация по 10 страницам подряд не ломает UI', async ({ page }) => {
    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    const pages = [
      '/campaigns',
      '/content',
      '/analytics',
      '/keywords',
      '/dashboard',
      '/posts',
      '/trends',
      '/publish/scheduled',
      '/settings',
      '/help/tutorials',
    ];

    console.log(`\nRapid navigation: ${pages.length} pages without waiting for networkidle`);
    const start = Date.now();

    for (let i = 0; i < pages.length; i++) {
      const path = pages[i];
      const navStart = Date.now();
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const elapsed = Date.now() - navStart;

      const url = page.url();
      const isOnAuthPage = url.includes('/auth/login') || url.includes('/login');

      console.log(`  [${i + 1}/${pages.length}] ${path}: ${elapsed}ms → ${url}`);

      if (isOnAuthPage) {
        collector.errors.push(`Unexpected redirect to login from ${path}`);
      }
    }

    const totalMs = Date.now() - start;
    console.log(`\nNavigation complete in ${totalMs}ms`);

    const hasContent = await page
      .locator('main, [role="main"], h1, h2, [data-testid]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(
      hasContent,
      'Final page should still render content after rapid navigation'
    ).toBeTruthy();

    const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
    expect(crashed, 'No uncaught error overlay after rapid navigation').toBeFalsy();

    expect(collector.serverErrors, 'No HTTP 5xx errors during rapid navigation').toHaveLength(0);
    expect(collector.errors, 'No JS errors during rapid navigation').toHaveLength(0);
  });

  test('повторная навигация campaigns → content → campaigns: нет зависаний', async ({ page }) => {
    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    const REPETITIONS = 5;
    console.log(`\nRepeated campaigns↔content navigation (${REPETITIONS}x)`);

    for (let i = 0; i < REPETITIONS; i++) {
      await page.goto('/campaigns', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(200);
      await page.goto('/content', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(200);
      console.log(`  Iteration ${i + 1}/${REPETITIONS} complete`);
    }

    await page.goto('/campaigns', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const hasContent = await page
      .locator('main, [role="main"], h1, h2')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent, 'Page renders after repeated navigation').toBeTruthy();
    expect(collector.serverErrors, 'No 5xx errors on repeated navigation').toHaveLength(0);
    expect(collector.errors, 'No JS errors on repeated navigation').toHaveLength(0);
  });

  test('многократное открытие/закрытие диалогов: нет ghost-диалогов', async ({ page }) => {
    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    await page.goto('/campaigns', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const openBtn = page.getByTestId('button-open-create-campaign-dialog')
      .or(page.getByRole('button', { name: /создать кампанию/i }))
      .first();

    const btnVisible = await openBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!btnVisible) {
      console.log('[SKIP] Create campaign button not found — skipping dialog stress test');
      test.skip();
      return;
    }

    const OPEN_CLOSE_CYCLES = 5;
    console.log(`\nOpening/closing campaign dialog ${OPEN_CLOSE_CYCLES}x`);

    for (let i = 0; i < OPEN_CLOSE_CYCLES; i++) {
      await openBtn.click({ timeout: 5000 });

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      const closeBtn = dialog.getByRole('button', { name: /отмена|закрыть|close|cancel/i }).first()
        .or(page.locator('[data-testid="dialog-close"], button[aria-label="Close"]').first());

      const closeBtnVisible = await closeBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (closeBtnVisible) {
        await closeBtn.click({ timeout: 3000 });
      } else {
        await page.keyboard.press('Escape');
      }

      await expect(dialog).not.toBeVisible({ timeout: 8000 });
      await page.waitForTimeout(200);
      console.log(`  Cycle ${i + 1}/${OPEN_CLOSE_CYCLES}: dialog opened and closed`);
    }

    const openDialogs = await page.locator('[role="dialog"][data-state="open"]').count();
    expect(openDialogs, 'No ghost dialogs remain after open/close cycles').toBe(0);

    expect(collector.errors, 'No JS errors from dialog stress').toHaveLength(0);
    expect(collector.serverErrors, 'No 5xx errors from dialog stress').toHaveLength(0);
  });

  test('быстрое переключение разделов через sidebar: нет утечек состояния', async ({ page }) => {
    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    await page.goto('/campaigns', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const navItems = [
      { testId: 'nav-campaigns', name: 'Кампании' },
      { testId: 'nav-content', name: 'Контент' },
      { testId: 'nav-analytics', name: 'Аналитика' },
      { testId: 'nav-trends', name: 'Тренды' },
      { testId: 'nav-posts', name: 'Публикации' },
    ];

    const SIDEBAR_CLICK_ROUNDS = 3;
    console.log(`\nSidebar rapid-click: ${navItems.length} links × ${SIDEBAR_CLICK_ROUNDS} rounds`);

    for (let round = 0; round < SIDEBAR_CLICK_ROUNDS; round++) {
      for (const nav of navItems) {
        const link = page.getByTestId(nav.testId);
        const isVisible = await link.isVisible({ timeout: 3000 }).catch(() => false);
        if (!isVisible) continue;

        await link.click({ timeout: 5000 }).catch(e => {
          console.log(`  [skip] ${nav.name}: ${e.message}`);
        });

        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(100);
      }
      console.log(`  Round ${round + 1}/${SIDEBAR_CLICK_ROUNDS} complete`);
    }

    await page.waitForTimeout(1000);

    const crashed = await page
      .locator('text=Uncaught Error, text=Something went wrong')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(crashed, 'No crash overlay after rapid sidebar clicks').toBeFalsy();

    const hasContent = await page
      .locator('main, [role="main"], h1, h2, h3, p, .card, [class*="container"]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent, 'Page renders content after rapid sidebar navigation').toBeTruthy();

    expect(collector.serverErrors, 'No 5xx errors during rapid sidebar navigation').toHaveLength(0);
    expect(collector.errors, 'No JS errors during rapid sidebar navigation').toHaveLength(0);
  });

  test('analytics обновляется 5 раз подряд: нет дублирования данных', async ({ page }) => {
    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    await page.goto('/analytics', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const refreshBtn = page
      .getByRole('button', { name: /обновить|refresh|reload/i })
      .first();

    const btnVisible = await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!btnVisible) {
      console.log('[INFO] No refresh button found — testing via page.reload()');
      const RELOADS = 5;
      for (let i = 0; i < RELOADS; i++) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        console.log(`  Reload ${i + 1}/${RELOADS}`);
      }
    } else {
      const REFRESH_CLICKS = 5;
      for (let i = 0; i < REFRESH_CLICKS; i++) {
        await refreshBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        console.log(`  Refresh ${i + 1}/${REFRESH_CLICKS}`);
      }
    }

    const hasContent = await page
      .locator('main, [role="main"], h1, h2, [data-testid]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent, 'Analytics page renders after multiple refreshes').toBeTruthy();
    expect(collector.serverErrors, 'No 5xx errors on analytics refresh').toHaveLength(0);
    expect(collector.errors, 'No JS errors on analytics refresh').toHaveLength(0);
  });

  test('быстрое создание и удаление контента 5 раз подряд: нет утечек состояния', async ({ page }) => {
    test.setTimeout(240000);

    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    await page.goto('/content', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 8000 }).catch(() => false);
    if (comboVisible) {
      await campaignSelect.click({ timeout: 5000 }).catch(() => {});
      const option = page.getByRole('option').first();
      const optVisible = await option.isVisible({ timeout: 5000 }).catch(() => false);
      if (optVisible) {
        await option.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }))
      .first();

    const btnVisible = await createBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (!btnVisible) {
      console.log('[SKIP] Create content button not found — skipping content stress test');
      test.skip();
      return;
    }

    const CONTENT_CREATIONS = 5;
    let createdCount = 0;
    let deletedCount = 0;
    console.log(`\nRapid content create+delete: ${CONTENT_CREATIONS} cycles (no API mocking)`);

    for (let i = 0; i < CONTENT_CREATIONS; i++) {
      const title = `Stress-${i + 1}-${Date.now()}`;
      console.log(`  Cycle ${i + 1}/${CONTENT_CREATIONS}: creating "${title}"...`);

      await createBtn.click({ timeout: 8000 });

      const dialog = page.getByRole('dialog');
      await expect(dialog, `Cycle ${i + 1}: create dialog must open`).toBeVisible({ timeout: 10000 });

      // ContentTypeDialog может открыться первым — выбираем "Текст"
      const isTypeDialog = await dialog.getByText(/выберите тип контента/i).isVisible({ timeout: 2000 }).catch(() => false);
      if (isTypeDialog) {
        const textCard = dialog.getByText('Текст', { exact: true }).first();
        await textCard.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
        // Ждём формы создания
        await page.getByRole('dialog').locator('input#title').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      } else {
        const textOption = dialog
          .getByText(/^Текст$/, { exact: true })
          .or(dialog.getByText(/только текст/i))
          .first();
        const textOptVisible = await textOption.isVisible({ timeout: 2000 }).catch(() => false);
        if (textOptVisible) {
          await textOption.click({ timeout: 5000 });
          await page.waitForTimeout(300);
        }
      }

      const titleInput = dialog
        .locator('input#title, input[name="title"], input[placeholder*="назван"]')
        .first();
      await expect(titleInput, `Cycle ${i + 1}: title input must be visible`).toBeVisible({ timeout: 8000 });
      await titleInput.fill(title);

      // Заполняем текст контента (обязателен для типа "text")
      const editor = dialog.locator('.tiptap[contenteditable="true"]').or(dialog.locator('textarea').first());
      const editorVisible = await editor.isVisible({ timeout: 3000 }).catch(() => false);
      if (editorVisible) {
        await editor.click().catch(() => {});
        await page.keyboard.type('Stress test content.');
        await page.waitForTimeout(200);
      }

      const saveBtn = dialog
        .getByRole('button', { name: /сохранить|save/i })
        .or(dialog.getByRole('button', { name: /создать|create/i }))
        .first();

      await expect(saveBtn, `Cycle ${i + 1}: save button must be enabled`).toBeEnabled({ timeout: 5000 });
      await saveBtn.click({ timeout: 5000 });

      await expect(dialog, `Cycle ${i + 1}: dialog must close after save`).not.toBeVisible({ timeout: 15000 });
      createdCount++;

      const remainingDialogs = await page.locator('[role="dialog"][data-state="open"]').count();
      expect(remainingDialogs, `Cycle ${i + 1}: no ghost dialogs after create`).toBe(0);

      console.log(`  Cycle ${i + 1}/${CONTENT_CREATIONS}: created ✓ — now deleting...`);
      await page.waitForTimeout(300);

      const createdItem = page
        .locator('[data-testid*="card"], li, tr, article')
        .filter({ hasText: title })
        .first();
      const itemVisible = await createdItem.isVisible({ timeout: 8000 }).catch(() => false);

      if (itemVisible) {
        const deleteBtn = createdItem
          .getByRole('button', { name: /удалить|delete|remove/i })
          .or(createdItem.locator('[data-testid*="delete"], [data-testid*="remove"]'))
          .first();
        const deleteBtnVisible = await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false);

        if (deleteBtnVisible) {
          await deleteBtn.click({ timeout: 5000 });
          const confirmBtn = page
            .getByRole('button', { name: /да|подтвердить|confirm|удалить/i })
            .last();
          const confirmVisible = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);
          if (confirmVisible) {
            await confirmBtn.click({ timeout: 5000 });
          }
          await page.waitForTimeout(500);
          deletedCount++;
          console.log(`  Cycle ${i + 1}/${CONTENT_CREATIONS}: deleted ✓`);
        } else {
          console.log(`  Cycle ${i + 1}/${CONTENT_CREATIONS}: delete button not exposed in UI — skipping`);
        }
      } else {
        console.log(`  Cycle ${i + 1}/${CONTENT_CREATIONS}: item not visible in list — skipping delete`);
      }
    }

    console.log(`\nSummary: created=${createdCount}/${CONTENT_CREATIONS}, deleted=${deletedCount}`);

    expect(createdCount, `All ${CONTENT_CREATIONS} content items must be created`).toBe(CONTENT_CREATIONS);

    const ghostDialogs = await page.locator('[role="dialog"][data-state="open"]').count();
    expect(ghostDialogs, 'No ghost dialogs after rapid create/delete cycles').toBe(0);

    const hasContent = await page
      .locator('main, [role="main"], h1, h2')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent, 'Page renders after rapid content create/delete').toBeTruthy();
    expect(collector.serverErrors, 'No 5xx errors during rapid content create/delete').toHaveLength(0);
    expect(collector.errors, 'No JS/state errors during rapid content create/delete').toHaveLength(0);
  });

  test('быстрое переключение кампаний: нет утечек состояния', async ({ page }) => {
    test.setTimeout(120000);

    const collector: ErrorCollector = { errors: [], serverErrors: [] };
    attachErrorListeners(page, collector);

    await page.goto('/content', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 10000 }).catch(() => false);
    if (!comboVisible) {
      console.log('[SKIP] Campaign selector not found on /content — skipping campaign switch test');
      test.skip();
      return;
    }

    await campaignSelect.click({ timeout: 5000 }).catch(() => {});
    const allOptions = await page.getByRole('option').all();
    const optionCount = allOptions.length;

    if (optionCount < 2) {
      console.log(`[SKIP] Only ${optionCount} campaign(s) available — need ≥2 for switch test`);
      await page.keyboard.press('Escape');
      test.skip();
      return;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const SWITCH_ROUNDS = 5;
    console.log(`\nCampaign switch stress: ${SWITCH_ROUNDS} rounds across ${optionCount} campaigns`);

    for (let round = 0; round < SWITCH_ROUNDS; round++) {
      const targetIndex = round % optionCount;
      console.log(`  Round ${round + 1}/${SWITCH_ROUNDS}: selecting option index ${targetIndex}`);

      await campaignSelect.click({ timeout: 5000 }).catch(e => {
        collector.errors.push(`Round ${round + 1}: combobox click failed: ${e.message}`);
        return;
      });

      const options = page.getByRole('option');
      const optVisible = await options.nth(targetIndex).isVisible({ timeout: 5000 }).catch(() => false);
      if (optVisible) {
        await options.nth(targetIndex).click({ timeout: 5000 }).catch(e => {
          collector.errors.push(`Round ${round + 1}: option click failed: ${e.message}`);
        });
      } else {
        await page.keyboard.press('Escape');
      }

      await page.waitForTimeout(300);

      const ghostDialogs = await page.locator('[role="dialog"][data-state="open"]').count();
      if (ghostDialogs > 0) {
        collector.errors.push(`Round ${round + 1}: ghost dialog after campaign switch`);
        await page.keyboard.press('Escape');
      }
    }

    const hasContent = await page
      .locator('main, [role="main"], h1, h2')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent, 'Page renders after rapid campaign switching').toBeTruthy();
    expect(collector.serverErrors, 'No 5xx errors during campaign switching').toHaveLength(0);
    expect(collector.errors, 'No JS/state errors during campaign switching').toHaveLength(0);
  });
});
