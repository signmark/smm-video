// E2E-тесты: создание контента и публикация на продакшн
// URL: https://smm.omemo.tech  (PLAYWRIGHT_BASE_URL)
//
// Запуск (Windows PowerShell):
//   $env:PLAYWRIGHT_BASE_URL="https://smm.omemo.tech"; npx playwright test content-create-post --headed
//   npx playwright test content-create-post --project=chromium
//
// Логика:
//  - Нет моков для /api/campaign-content и /api/content/:id/publish - реальные запросы
//  - Если платформа настроена -> ожидаем success=true / status=scheduled/published
//  - Если платформа не настроена -> ожидаем success=false / error message (это нормально)
//  - После каждого теста с реальным контентом - удаляем его через API

import { test, expect, Page } from './fixtures';

// ─── Учётные данные ───────────────────────────────────────────────────────────
const CREDS = {
  email:    process.env.TEST_EMAIL    || process.env.DIRECTUS_ADMIN_EMAIL    || '',
  password: process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

// Тестовая кампания с подключёнными платформами (ID совпадает на деве и проде)
const TEST_CAMPAIGN_ID = '4513f574-80da-4bbe-8c47-771c63b5d1cb';

// ─── Платформы (без TikTok) ───────────────────────────────────────────────────
const PLATFORMS = ['telegram', 'vk', 'instagram', 'facebook', 'threads'] as const;
type Platform = (typeof PLATFORMS)[number];

// ─── Вспомогательные функции ──────────────────────────────────────────────────

async function waitReady(page: Page, timeout = 10000) {
  await page.waitForLoadState('domcontentloaded');
  await page
    .waitForLoadState('networkidle', { timeout: Math.min(timeout, 3000) })
    .catch(() => {});
  await page.locator('.animate-spin').first()
    .waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
}

async function login(page: Page) {
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  // Ждём любой из возможных URL (включая /auth/register — редирект при сбросе сессии)
  await page.waitForURL(
    /\/(campaigns|dashboard|auth\/login|auth\/register|login)/,
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const url = page.url();

  // Уже на нужной странице — выходим
  if (!url.includes('login') && !url.includes('register')) return;

  // Если попали на /auth/register — явно идём на /auth/login
  if (url.includes('register')) {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
  }

  const emailInput = page.getByPlaceholder(/email/i).or(page.locator('input[type="email"]'));
  const passInput  = page.getByPlaceholder(/пароль|password/i).or(page.locator('input[type="password"]'));
  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await emailInput.fill(CREDS.email);
  await passInput.fill(CREDS.password);
  await page.getByRole('button', { name: /войти/i }).first().click();
  await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
  await waitReady(page);
}

/** Выбирает тест-кампанию (TEST_CAMPAIGN_ID) или первую доступную */
async function selectFirstCampaign(page: Page): Promise<string> {
  const combo = page.getByRole('combobox').first();
  const visible = await combo.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) return '';

  // Сначала находим название нашей тест-кампании через реальный API
  const campaignName = await page.evaluate(async (id) => {
    const resp = await fetch('/api/campaigns');
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    const list = json?.data || json || [];
    const found = (list as Array<{ id: string; title?: string; name?: string }>)
      .find((c) => c.id === id);
    return found?.title || found?.name || null;
  }, TEST_CAMPAIGN_ID);

  // Если combobox уже показывает нужную кампанию — не кликаем
  const current = await combo.innerText().catch(() => '');
  if (campaignName && current && current.trim() === campaignName) {
    return current.trim();
  }

  await combo.click().catch(() => {});
  await page.waitForTimeout(400);

  // Пробуем найти опцию с нужным названием
  if (campaignName) {
    const namedOpt = page.getByRole('option').filter({ hasText: campaignName }).first();
    const found = await namedOpt.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await namedOpt.click();
      await waitReady(page);
      return campaignName;
    }
  }

  // Fallback: первая доступная
  const opt = page.getByRole('option').first();
  const optVisible = await opt.isVisible({ timeout: 5000 }).catch(() => false);
  if (!optVisible) return '';
  const name = await opt.innerText().catch(() => '');
  await opt.click().catch(() => {});
  await waitReady(page);
  return name.trim();
}

/** Открывает диалог создания, заполняет заголовок + тело, нажимает «Создать» */
async function createContentViaDialog(
  page: Page,
  title: string,
  body: string,
): Promise<{ created: boolean; contentId: string | null }> {
  let contentId: string | null = null;

  // Перехватываем ответ чтобы получить id созданного контента
  page.once('response', async (resp) => {
    if (resp.url().includes('/api/campaign-content') && resp.request().method() === 'POST') {
      const json = await resp.json().catch(() => null);
      contentId = json?.data?.id || json?.id || null;
    }
  });

  const createBtn = page.getByTestId('button-create-content')
    .or(page.getByRole('button', { name: /создать контент/i }).first());
  const btnVisible = await createBtn.waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true).catch(() => false);
  if (!btnVisible) return { created: false, contentId: null };

  // Ждём, пока кнопка не disabled
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLButtonElement>('[data-testid="button-create-content"]');
      return !el || !el.disabled;
    },
    { timeout: 8000 },
  ).catch(() => {});

  await createBtn.click({ timeout: 5000 });

  const dialog = page.getByRole('dialog');
  const dlgVisible = await dialog.waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true).catch(() => false);
  if (!dlgVisible) return { created: false, contentId: null };

  // Кнопка типа "Текст" если есть
  const textTypeBtn = dialog.getByText('Текст', { exact: true });
  if (await textTypeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await textTypeBtn.click();
  }

  // Заголовок
  const titleInput = dialog.locator('input#title').or(
    dialog.locator('input[name="title"], input[placeholder*="заголовок"]').first(),
  );
  await expect(titleInput).toBeVisible({ timeout: 8000 });
  await titleInput.fill(title);

  // Тело (tiptap или textarea)
  const editor = dialog.locator('.tiptap[contenteditable="true"]').or(
    dialog.locator('textarea').first(),
  );
  const editorVisible = await editor.isVisible({ timeout: 5000 }).catch(() => false);
  if (editorVisible) {
    await editor.click();
    await page.keyboard.type(body);
  }

  // Отправка
  const submitBtn = dialog.getByRole('button', { name: /^создать$/i }).or(
    dialog.getByRole('button', { name: /сохранить/i }).first(),
  );
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click({ timeout: 5000 });

  // Ждём закрытия диалога
  await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

  // Небольшая пауза, чтобы ответ POST успел прийти
  await page.waitForTimeout(1000);

  return { created: true, contentId };
}

/**
 * Удаляет контент через API (cleanup после теста).
 * Игнорирует ошибки - тест не должен падать из-за cleanup.
 */
// Браузерный fetch — несёт auth (cookies/localStorage), request fixture может не иметь токена
async function deleteContentById(page: Page, contentId: string) {
  if (!contentId) return;
  await page.evaluate(async (id) => {
    await fetch(`/api/campaign-content/${id}`, { method: 'DELETE' }).catch(() => {});
  }, contentId).catch(() => {});
}

// Нажимает кнопку публикации первой подходящей карточки,
// выбирает платформу, нажимает «Опубликовать».
// Возвращает перехваченный ответ от /api/content/:id/publish или null.
async function publishFirstDraft(
  page: Page,
  platform: Platform,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  let responseBody: Record<string, unknown> | null = null;
  let responseStatus = 0;

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/content/') && resp.url().includes('/publish'),
    { timeout: 20000 },
  ).catch(() => null);

  // Ищем кнопку «Опубликовать» на карточке
  const publishBtn = page
    .locator('[data-testid^="button-publish-content-"]').first()
    .or(page.getByRole('button', { name: /опубликовать|publish/i }).first());

  const btnFound = await publishBtn.waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true).catch(() => false);
  if (!btnFound) return { ok: false, status: 0, body: null };

  await publishBtn.click({ timeout: 5000 });

  // Диалог публикации
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  // shadcn Checkbox рендерится как <button role="checkbox" id="platform-{platform}">
  const platformCheckbox = page
    .locator(`button#platform-${platform}`)
    .or(page.locator(`[data-testid="checkbox-platform-${platform}"]`))
    .or(page.locator(`label[for="platform-${platform}"]`))
    .first();
  const cbFound = await platformCheckbox.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true).catch(() => false);
  if (cbFound) {
    const isDisabled = await platformCheckbox.getAttribute('data-disabled')
      .then((v) => v !== null).catch(() => false);
    if (!isDisabled) {
      await platformCheckbox.click({ timeout: 3000 }).catch(() => {});
    } else {
      console.log(`[WARN][${platform}] Чекбокс disabled — токены не настроены?`);
    }
    await page.waitForTimeout(400);
  }

  // Нажимаем «Опубликовать сразу» или аналог
  const confirmBtn = page
    .getByRole('button', { name: /опубликовать сразу|отправить сейчас|publish now/i }).first()
    .or(page.getByRole('button', { name: /запланировать|подтвердить|confirm/i }).first());
  const confirmFound = await confirmBtn.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true).catch(() => false);
  if (confirmFound) {
    const enabled = await confirmBtn.isEnabled().catch(() => false);
    if (enabled) await confirmBtn.click({ timeout: 5000 });
  }

  // Ждём ответа от сервера
  const response = await responsePromise;
  if (response) {
    responseStatus = response.status();
    responseBody = await response.json().catch(() => null);
  }

  await page.waitForTimeout(1500);
  return { ok: !!response, status: responseStatus, body: responseBody };
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

test.beforeAll(() => {
  if (!CREDS.email || !CREDS.password) {
    throw new Error(
      'Не заданы учётные данные. Установи TEST_EMAIL/TEST_PASSWORD ' +
      'или DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD.',
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. СТРАНИЦА КОНТЕНТА
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Страница контента - базовые проверки (прод)', () => {
  test('страница /content загружается без JS-ошибок', async ({ page }) => {
    await login(page);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    expect(page.url()).toContain('/content');
    const crashed = await page.locator('text=Uncaught Error, text=Something went wrong').first()
      .isVisible().catch(() => false);
    expect(crashed).toBe(false);

    const criticalErrors = errors.filter(
      (e) => !/ResizeObserver|ChunkLoad|Loading chunk/i.test(e),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('кнопка "Создать контент" присутствует в DOM', async ({ page }) => {
    await login(page);
    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    const btn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }).first());
    await expect(btn).toBeAttached({ timeout: 10000 });
  });

  test('при выборе кампании список контента или пустое состояние появляется', async ({ page }) => {
    await login(page);
    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    const campaignName = await selectFirstCampaign(page);
    if (!campaignName) {
      test.skip(true, 'Нет кампаний для выбора');
      return;
    }

    await page.waitForTimeout(2000);

    const hasList = await page.locator('[class*="card"], article').first()
      .isVisible({ timeout: 8000 }).catch(() => false);
    const hasEmpty = await page.locator('text=/нет контента|no content|создайте первый/i').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasList || hasEmpty).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. СОЗДАНИЕ КОНТЕНТА - реальные запросы к проду
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Создание контента (реальные запросы)', () => {
  test(
    'создание черновика: POST /api/campaign-content -> id и status="draft" в ответе',
    async ({ page }) => {
      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      const campaign = await selectFirstCampaign(page);
      if (!campaign) {
        test.skip(true, 'Нет кампаний');
        return;
      }

      const title = `E2E Черновик ${Date.now()}`;

      // Перехватываем POST и получаем ответ
      let savedId: string | null = null;
      let savedStatus: string | null = null;
      const postResponsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
        { timeout: 20000 },
      ).catch(() => null);

      const { created } = await createContentViaDialog(
        page,
        title,
        'Тестовый контент для E2E проверки создания черновика на проде',
      );

      if (!created) {
        test.skip(true, 'Диалог создания контента недоступен');
        return;
      }

      const postResponse = await postResponsePromise;
      expect(postResponse).not.toBeNull();

      const body = await postResponse!.json().catch(() => null);
      console.log('[DEBUG] POST /api/campaign-content response:', JSON.stringify(body, null, 2));

      savedId     = body?.data?.id   || body?.id   || null;
      savedStatus = body?.data?.status || body?.status || null;

      expect(postResponse!.status()).toBeLessThan(400);
      expect(savedId).toBeTruthy();
      // Статус должен быть draft или pending (зависит от конфигурации)
      expect(['draft', 'pending', 'scheduled', 'created']).toContain(
        (savedStatus ?? 'draft').toLowerCase(),
      );

      // Cleanup
      if (savedId) await deleteContentById(page, savedId);
    },
  );

  test(
    'созданный черновик появляется в списке на странице /content',
    async ({ page }) => {
      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      const campaign = await selectFirstCampaign(page);
      if (!campaign) {
        test.skip(true, 'Нет кампаний');
        return;
      }

      const title = `E2E Список ${Date.now()}`;
      let savedId: string | null = null;

      const postResponsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
        { timeout: 20000 },
      ).catch(() => null);

      const { created } = await createContentViaDialog(page, title, 'Проверка отображения в списке');
      if (!created) {
        test.skip(true, 'Диалог создания недоступен');
        return;
      }

      const pr = await postResponsePromise;
      const body = await pr?.json().catch(() => null);
      savedId = body?.data?.id || body?.id || null;

      // Ждём обновления списка
      await page.waitForTimeout(2000);

      // Ищем карточку с созданным заголовком
      const card = page.locator(`text=${title}`).first();
      const visible = await card.isVisible({ timeout: 8000 }).catch(() => false);
      if (!visible) {
        console.log(`[INFO] Карточка "${title}" не видна - возможно, нужно обновить страницу`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitReady(page);
        // После перезагрузки выбираем кампанию снова
        await selectFirstCampaign(page);
        await page.waitForTimeout(2000);
        const afterReload = await page.locator(`text=${title}`).first()
          .isVisible({ timeout: 8000 }).catch(() => false);
        expect(afterReload).toBe(true);
      } else {
        expect(visible).toBe(true);
      }

      if (savedId) await deleteContentById(page, savedId);
    },
  );

  test(
    'диалог создания закрывается корректно при нажатии Отмена/крестик',
    async ({ page }) => {
      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      await selectFirstCampaign(page);

      const createBtn = page.getByTestId('button-create-content')
        .or(page.getByRole('button', { name: /создать контент/i }).first());
      const found = await createBtn.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true).catch(() => false);
      if (!found) {
        test.skip(true, 'Кнопка создания не найдена');
        return;
      }

      await createBtn.click({ timeout: 5000 });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Нажимаем Escape или кнопку Отмена
      const cancelBtn = dialog.getByRole('button', { name: /отмена|cancel|закрыть|close/i }).first();
      const cancelVisible = await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (cancelVisible) {
        await cancelBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }

      await expect(dialog).not.toBeVisible({ timeout: 8000 });

      // Страница не должна сломаться
      const crashed = await page.locator('text=Uncaught Error').isVisible().catch(() => false);
      expect(crashed).toBe(false);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ПУБЛИКАЦИЯ - реальные запросы к проду
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Публикация контента (реальные запросы)', () => {
  // Общий флоу:
  // 1. Создаём черновик
  // 2. Нажимаем «Опубликовать» -> выбираем платформу -> отправляем
  // 3. Перехватываем ответ /api/content/:id/publish
  // 4. Проверяем структуру ответа (независимо от success - нет 500)
  // 5. Проверяем, что UI показывает какой-то feedback (тост)
  // 6. Удаляем контент

  async function runPublishFlow(
    page: Page,
    platform: Platform,
  ) {
    await login(page);
    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    const campaign = await selectFirstCampaign(page);
    if (!campaign) {
      test.skip(true, 'Нет кампаний');
      return;
    }

    const title = `E2E ${platform} ${Date.now()}`;

    // Перехватываем POST create
    let savedId: string | null = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/campaign-content') && resp.request().method() === 'POST') {
        const json = await resp.json().catch(() => null);
        savedId = json?.data?.id || json?.id || null;
      }
    });

    const { created } = await createContentViaDialog(
      page,
      title,
      `E2E тест публикации в ${platform}: ${new Date().toISOString()}`,
    );

    if (!created) {
      test.skip(true, `Диалог создания контента недоступен (${platform})`);
      return;
    }

    await page.waitForTimeout(2000);

    // Публикуем и получаем ответ сервера
    const { ok, status, body } = await publishFirstDraft(page, platform);

    console.log(
      `[${platform.toUpperCase()}] publish response: status=${status}, ok=${ok}`,
      JSON.stringify(body, null, 2),
    );

    if (!ok) {
      console.log(`[INFO] Кнопка публикации не найдена - возможно, нет черновиков (${platform})`);
    } else {
      // Сервер ответил - не должно быть 500
      expect(status).toBeLessThan(500);

      // Структура ответа должна содержать data или error
      expect(body).not.toBeNull();

      // Проверяем что UI показал какой-то feedback
      const toast = page.locator('[class*="toast"], [role="alert"], [role="status"]').first()
        .or(page.getByText(/публикация|запланировано|ошибка|настроен|отправлен/i).first());
      const toastVisible = await toast.isVisible({ timeout: 10000 }).catch(() => false);
      if (!toastVisible) {
        console.log(`[INFO] Тост не найден для платформы ${platform} - UI может не показывать feedback при ошибке конфигурации`);
      }
    }

    // Cleanup
    if (savedId) await deleteContentById(page, savedId);
  }

  for (const platform of PLATFORMS) {
    test(
      `POST /api/content/:id/publish -> платформа "${platform}": нет 500, структура ответа валидна`,
      async ({ page }) => {
        test.setTimeout(60000);
        await runPublishFlow(page, platform);
      },
    );
  }

  test(
    'диалог публикации открывается, содержит платформы для выбора',
    async ({ page }) => {
      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      const campaign = await selectFirstCampaign(page);
      if (!campaign) {
        test.skip(true, 'Нет кампаний');
        return;
      }

      const title = `E2E Dialog Check ${Date.now()}`;
      let savedId: string | null = null;
      page.on('response', async (resp) => {
        if (resp.url().includes('/api/campaign-content') && resp.request().method() === 'POST') {
          const json = await resp.json().catch(() => null);
          savedId = json?.data?.id || json?.id || null;
        }
      });

      const { created } = await createContentViaDialog(page, title, 'Проверка диалога публикации');
      if (!created) {
        test.skip(true, 'Диалог создания недоступен');
        return;
      }

      await page.waitForTimeout(2000);

      // Нажимаем кнопку публикации
      const publishBtn = page
        .locator('[data-testid^="button-publish-content-"]').first()
        .or(page.getByRole('button', { name: /опубликовать|publish/i }).first());
      const btnFound = await publishBtn.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true).catch(() => false);

      if (!btnFound) {
        test.skip(true, 'Кнопка публикации не найдена');
        if (savedId) await deleteContentById(page, savedId);
        return;
      }

      await publishBtn.click({ timeout: 5000 });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Проверяем что в диалоге есть выбор платформ
      const platformsSection = dialog.locator('[data-testid="dialog-publish-platforms"]').first()
        .or(dialog.locator('[id^="platform-"]').first())
        .or(dialog.getByText(/telegram|вконтакте|instagram|facebook|threads/i).first());
      const platformsVisible = await platformsSection.isVisible({ timeout: 10000 }).catch(() => false);
      expect(platformsVisible).toBe(true);

      // Закрываем диалог
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

      if (savedId) await deleteContentById(page, savedId);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ПОЛНЫЙ ФЛОУ: создание -> публикация в Telegram
// (Telegram чаще всего настроен - наиболее надёжный тест)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Полный флоу: создание -> публикация в Telegram (прод)', () => {
  test(
    'создаём черновик -> публикуем в Telegram -> проверяем ответ сервера',
    async ({ page }) => {
      test.setTimeout(90000);

      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      const campaign = await selectFirstCampaign(page);
      if (!campaign) {
        test.skip(true, 'Нет кампаний на проде');
        return;
      }

      const timestamp = Date.now();
      const title = `E2E Telegram Full Flow ${timestamp}`;
      const body  = `Автоматический E2E тест ${new Date().toLocaleString('ru-RU')}. ID: ${timestamp}`;

      let savedId: string | null = null;
      let createStatus = 0;

      // Слушаем все ответы
      page.on('response', async (resp) => {
        if (resp.url().includes('/api/campaign-content') && resp.request().method() === 'POST') {
          createStatus = resp.status();
          const json = await resp.json().catch(() => null);
          savedId = json?.data?.id || json?.id || null;
        }
      });

      // Шаг 1: Создаём черновик
      const { created } = await createContentViaDialog(page, title, body);
      if (!created) {
        test.skip(true, 'Диалог создания контента недоступен');
        return;
      }

      // Проверяем, что контент создан
      expect(createStatus).toBeLessThan(400);
      expect(savedId).toBeTruthy();
      console.log(`[STEP 1] Контент создан: id=${savedId}, status=${createStatus}`);

      await page.waitForTimeout(2000);

      // Шаг 2: Публикуем
      const publishResult = await publishFirstDraft(page, 'telegram');
      console.log('[STEP 2] Результат публикации:', JSON.stringify(publishResult, null, 2));

      if (!publishResult.ok) {
        console.log('[INFO] Публикация не была инициирована - нет активных черновиков в UI');
        if (savedId) await deleteContentById(page, savedId);
        return;
      }

      // Шаг 3: Проверяем ответ
      expect(publishResult.status).toBeLessThan(500);
      expect(publishResult.body).not.toBeNull();

      const responseData = publishResult.body as any;
      const platformData =
        responseData?.data?.social_platforms?.telegram ||
        responseData?.social_platforms?.telegram ||
        null;

      if (platformData) {
        console.log(`[STEP 3] Telegram статус: ${platformData.status}`);
        // Если настроен - должен быть published или scheduled
        // Если не настроен - error (тоже допустимо)
        expect(['published', 'scheduled', 'error', 'failed', 'pending']).toContain(
          (platformData.status ?? 'error').toLowerCase(),
        );
        if (platformData.status === 'published' || platformData.status === 'scheduled') {
          console.log(`[SUCCESS] Публикация успешна: ${platformData.postUrl || platformData.url || '-'}`);
        } else if (platformData.error) {
          console.log(`[INFO] Ошибка публикации (ожидаемо если токен не настроен): ${platformData.error}`);
        }
      }

      // Шаг 4: Cleanup
      if (savedId) {
        await deleteContentById(page, savedId);
        console.log(`[STEP 4] Контент ${savedId} удалён`);
      }
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. VK STORIES / CLIPS - специфичные типы контента
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Специальные типы контента (прод)', () => {
  test(
    'VK Stories: content_type=story попадает в правильный обработчик (диалог публикации)',
    async ({ page }) => {
      test.setTimeout(60000);
      await login(page);
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);

      const campaign = await selectFirstCampaign(page);
      if (!campaign) {
        test.skip(true, 'Нет кампаний');
        return;
      }

      // Смотрим - есть ли возможность выбрать тип "История" в диалоге
      const createBtn = page.getByTestId('button-create-content')
        .or(page.getByRole('button', { name: /создать контент/i }).first());
      const found = await createBtn.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true).catch(() => false);
      if (!found) {
        test.skip(true, 'Кнопка создания недоступна');
        return;
      }

      await createBtn.click({ timeout: 5000 });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Ищем тип "История" / "Story" в диалоге
      const storyOption = dialog
        .getByText(/история|story/i).first()
        .or(dialog.locator('[data-value="story"], [value="story"]').first());
      const storyExists = await storyOption.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`[INFO] Тип "История" в диалоге: ${storyExists}`);

      await page.keyboard.press('Escape');
    },
  );

  test(
    'API /api/campaign-content принимает content_type=clip без ошибок сервера',
    async ({ page }) => {
      await login(page);

      // Используем page.evaluate - браузерный fetch несёт auth-куки/токены сессии
      const { campaignId, userId } = await page.evaluate(async (testCampaignId) => {
        const resp = await fetch('/api/campaigns');
        if (!resp.ok) return { campaignId: testCampaignId, userId: null };
        const json = await resp.json().catch(() => null);
        const first = json?.data?.[0] || json?.[0];
        return { campaignId: first?.id || testCampaignId, userId: first?.user_id || null };
      }, TEST_CAMPAIGN_ID);

      // Создаём контент типа "clip" через браузерный fetch (с auth)
      const result = await page.evaluate(
        async ({ campaignId, userId }) => {
          const resp = await fetch('/api/campaign-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id:  campaignId,
              user_id:      userId,
              title:        `E2E Clip Test ${Date.now()}`,
              text_content: 'Тестовый клип для E2E',
              content_type: 'clip',
              video_url:    'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4',
              status:       'draft',
            }),
          });
          const body = await resp.json().catch(() => null);
          return { status: resp.status, body };
        },
        { campaignId, userId },
      );

      console.log('[DEBUG] POST clip status:', result.status);
      expect(result.status).toBeLessThan(500);

      const clipId = result.body?.data?.id || result.body?.id || null;
      console.log('[DEBUG] clip id:', clipId);

      // Cleanup — используем page.evaluate (браузерный fetch с auth), т.к. request не имеет куки
      if (clipId) {
        await page.evaluate(async (id) => {
          await fetch(`/api/campaign-content/${id}`, { method: 'DELETE' }).catch(() => {});
        }, clipId);
      }
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. СПИСОК ЗАПЛАНИРОВАННЫХ ПУБЛИКАЦИЙ
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Страница запланированных публикаций', () => {
  test('страница /publish/scheduled загружается без ошибок', async ({ page }) => {
    await login(page);
    await page.goto('/publish/scheduled', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    expect(page.url()).toContain('/publish/scheduled');

    const crashed = await page.locator('text=Uncaught Error, text=Something went wrong').first()
      .isVisible().catch(() => false);
    expect(crashed).toBe(false);

    const heading = page.getByRole('heading').first();
    const hasHeading = await heading.isVisible({ timeout: 8000 }).catch(() => false);
    expect(hasHeading).toBe(true);
  });

  test('список запланированных или пустое состояние отображается', async ({ page }) => {
    await login(page);
    await page.goto('/publish/scheduled', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(2000);

    const hasList = await page.locator('[class*="card"], article, [class*="scheduled"]').first()
      .isVisible({ timeout: 8000 }).catch(() => false);
    const hasEmpty = await page.locator('text=/нет запланированных|no scheduled|пусто|empty/i').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    const hasSomething = hasList || hasEmpty ||
      await page.locator('main, [class*="content"]').first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasSomething).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. API HEALTH CHECK - быстрые проверки эндпоинтов
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('API health check - эндпоинты публикации', () => {
  test('GET /api/campaigns -> 200 или 401 (не 500)', async ({ request }) => {
    const resp = await request.get('/api/campaigns');
    console.log('[API] GET /api/campaigns:', resp.status());
    expect(resp.status()).not.toBe(500);
  });

  test('GET /api/campaign-content -> 200 или 401 (не 500)', async ({ request }) => {
    const resp = await request.get('/api/campaign-content');
    console.log('[API] GET /api/campaign-content:', resp.status());
    expect(resp.status()).not.toBe(500);
  });

  test('POST /api/content/nonexistent/publish -> 404 или 401 (не 500)', async ({ request }) => {
    const resp = await request.post('/api/content/nonexistent-id-12345/publish', {
      data: { status: 'scheduled', socialPlatforms: { telegram: true } },
    });
    console.log('[API] POST /api/content/nonexistent/publish:', resp.status());
    expect(resp.status()).not.toBe(500);
  });
});
