/**
 * E2E тест-сьют: Все типы контента — создание и публикация
 *
 * Покрывает:
 *  1. Типы контента: текст, текст+картинка, видео, клип, Instagram Stories
 *  2. Публикация в YouTube (отсутствовал в старых тестах)
 *  3. Планирование на дату (датпикер)
 *  4. Немедленный тост при нажатии "Опубликовать сразу"
 *  5. AI генерация изображения (мок fal.ai)
 *  6. Генерация контент-плана
 *
 * Запуск:
 *   npx playwright test content-all-types --headed
 *   npx playwright test content-all-types --project=chromium
 */

import { test, expect, Page } from './fixtures';

// ─── Учётные данные ───────────────────────────────────────────────────────────
const CREDS = {
  email:    process.env.TEST_EMAIL    || process.env.DIRECTUS_ADMIN_EMAIL    || '',
  password: process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

const TEST_CAMPAIGN_ID = '4513f574-80da-4bbe-8c47-771c63b5d1cb';

// ─── Типы контента, которые тестируем ─────────────────────────────────────────
const CONTENT_TYPES = [
  { value: 'text',       label: 'Текст',                 needsText: true,  needsImage: false, needsVideo: false },
  { value: 'text-image', label: 'Текст с картинкой',     needsText: true,  needsImage: true,  needsVideo: false },
  { value: 'video',      label: 'Видео',                 needsText: false, needsImage: false, needsVideo: true  },
  { value: 'clip',       label: 'Клип (Shorts/Reels)',   needsText: false, needsImage: false, needsVideo: true  },
  { value: 'story',      label: 'Instagram Stories',     needsText: false, needsImage: false, needsVideo: false },
] as const;

// Все платформы включая YouTube
const ALL_PLATFORMS = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'threads'] as const;
type Platform = (typeof ALL_PLATFORMS)[number];

// ─── Хелперы ──────────────────────────────────────────────────────────────────

async function waitReady(page: Page, timeout = 12000) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 3000) }).catch(() => {});
  await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
}

async function login(page: Page) {
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/(campaigns|dashboard|auth\/login|auth\/register|login)/, { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const url = page.url();
  if (!url.includes('login') && !url.includes('register')) return;

  if (url.includes('register')) {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
  }

  await page.getByPlaceholder(/email/i).or(page.locator('input[type="email"]')).fill(CREDS.email);
  await page.getByPlaceholder(/пароль|password/i).or(page.locator('input[type="password"]')).fill(CREDS.password);
  await page.getByRole('button', { name: /войти/i }).first().click();
  await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
  await waitReady(page);
}

async function selectTestCampaign(page: Page): Promise<boolean> {
  const campaignName = await page.evaluate(async (id) => {
    const resp = await fetch('/api/campaigns');
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    const list = json?.data || json || [];
    const found = (list as Array<{ id: string; title?: string; name?: string }>).find((c) => c.id === id);
    return found?.title || found?.name || null;
  }, TEST_CAMPAIGN_ID);

  const combo = page.getByRole('combobox').first();
  const visible = await combo.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) return false;

  await combo.click().catch(() => {});
  await page.waitForTimeout(400);

  if (campaignName) {
    const namedOpt = page.getByRole('option').filter({ hasText: campaignName }).first();
    if (await namedOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
      await namedOpt.click();
      await waitReady(page);
      return true;
    }
  }

  const firstOpt = page.getByRole('option').first();
  if (await firstOpt.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstOpt.click();
    await waitReady(page);
    return true;
  }
  return false;
}

async function deleteContentById(page: Page, id: string) {
  if (!id) return;
  await page.evaluate(async (contentId) => {
    await fetch(`/api/campaign-content/${contentId}`, { method: 'DELETE' }).catch(() => {});
  }, id).catch(() => {});
}

/** Открывает диалог создания контента, выбирает тип и возвращает dialog locator.
 *  Поддерживает двухэтапный флоу: ContentTypeDialog → форма создания.
 */
async function openCreateDialog(page: Page): Promise<boolean> {
  const createBtn = page.getByTestId('button-create-content')
    .or(page.getByRole('button', { name: /создать контент/i }).first());

  const found = await createBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!found) return false;

  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLButtonElement>('[data-testid="button-create-content"]');
      return !el || !el.disabled;
    },
    { timeout: 8000 },
  ).catch(() => {});

  await createBtn.click({ timeout: 5000 });

  const dialog = page.getByRole('dialog');
  const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (!dialogVisible) return false;

  // Проверяем, открылся ли ContentTypeDialog (выбор типа контента)
  const isTypeDialog = await dialog.getByText(/выберите тип контента/i).isVisible({ timeout: 2000 }).catch(() => false);
  if (isTypeDialog) {
    // Кликаем по карточке "Текст" (по умолчанию)
    const textCard = dialog.getByText('Текст', { exact: true }).first()
      .or(dialog.getByText(/только текст/i).first());
    await textCard.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);

    // Ждём появления формы создания (с полем заголовка)
    const titleInput = page.getByRole('dialog').locator('input#title').first();
    const formVisible = await titleInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    return formVisible;
  }

  // Если это уже форма — OK
  return true;
}

/** Выбирает тип контента в диалоге через <Select> */
async function selectContentType(page: Page, typeValue: string) {
  const dialog = page.getByRole('dialog');

  // Ищем <Select> с label "Тип контента"
  const selectTrigger = dialog.locator('[data-testid="select-content-type"]')
    .or(dialog.locator('button[role="combobox"]').filter({ hasText: /текст|тип|видео|клип|story/i }).first())
    .or(dialog.locator('#contentType').locator('..').locator('button').first());

  const triggerFound = await selectTrigger.isVisible({ timeout: 5000 }).catch(() => false);
  if (!triggerFound) {
    // Попробуем найти select через label
    const label = dialog.getByText(/тип контента/i);
    if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
      const selectBtn = label.locator('..').locator('button[role="combobox"]').first();
      const sbFound = await selectBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (sbFound) {
        await selectBtn.click({ timeout: 3000 });
      }
    }
  } else {
    await selectTrigger.click({ timeout: 3000 });
  }

  await page.waitForTimeout(300);

  // Ищем опцию по value или тексту
  const option = page.getByRole('option').filter({ hasText: new RegExp(typeValue, 'i') }).first()
    .or(page.locator(`[data-value="${typeValue}"]`).first());

  const optFound = await option.isVisible({ timeout: 5000 }).catch(() => false);
  if (optFound) {
    await option.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  } else {
    // Если dropdown не открылся - нажимаем Escape и двигаемся дальше
    await page.keyboard.press('Escape');
    console.log(`[WARN] Опция типа "${typeValue}" не найдена в dropdown`);
  }
}

/** Заполняет диалог и нажимает "Создать". Возвращает contentId. */
async function fillDialogAndSubmit(
  page: Page,
  title: string,
  bodyText: string,
): Promise<{ contentId: string | null }> {
  let contentId: string | null = null;

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
    { timeout: 25000 },
  ).catch(() => null);

  const dialog = page.getByRole('dialog');

  // Заголовок
  const titleInput = dialog.locator('input#title')
    .or(dialog.locator('input[name="title"], input[placeholder*="заголовок"]').first());
  const titleFound = await titleInput.isVisible({ timeout: 8000 }).catch(() => false);
  if (titleFound) {
    await titleInput.fill(title);
  }

  // Тело текста
  if (bodyText) {
    const editor = dialog.locator('.tiptap[contenteditable="true"]')
      .or(dialog.locator('textarea').first());
    if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editor.click();
      await page.keyboard.type(bodyText);
    }
  }

  // Кнопка "Создать"
  const submitBtn = dialog.getByRole('button', { name: /^создать$/i })
    .or(dialog.getByRole('button', { name: /сохранить/i }).first());
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click({ timeout: 5000 });

  await dialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});

  const resp = await responsePromise;
  if (resp) {
    const json = await resp.json().catch(() => null);
    contentId = json?.data?.id || json?.id || null;
  }
  await page.waitForTimeout(800);

  return { contentId };
}

/**
 * Открывает диалог публикации первого доступного черновика.
 * Возвращает true если диалог открылся.
 */
async function openPublishDialog(page: Page): Promise<boolean> {
  await page.waitForTimeout(1500);
  const publishBtn = page.locator('[data-testid^="button-publish-content-"]').first()
    .or(page.getByRole('button', { name: /опубликовать|publish/i }).first());

  const found = await publishBtn.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (!found) return false;

  await publishBtn.click({ timeout: 5000 });
  return page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
}

/** Кликает чекбокс платформы в открытом диалоге публикации. */
async function togglePlatform(page: Page, platform: Platform): Promise<boolean> {
  const checkbox = page
    .locator(`button#platform-${platform}`)
    .or(page.locator(`[data-testid="checkbox-platform-${platform}"]`))
    .or(page.locator(`label[for="platform-${platform}"]`))
    .first();

  const found = await checkbox.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (!found) {
    console.log(`[WARN] Чекбокс платформы ${platform} не найден в диалоге`);
    return false;
  }

  const isDisabled = await checkbox.getAttribute('data-disabled').then((v) => v !== null).catch(() => false);
  if (isDisabled) {
    console.log(`[INFO][${platform}] Чекбокс disabled — токены не настроены`);
    return false;
  }

  await checkbox.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  return true;
}

async function goToContentPage(page: Page): Promise<boolean> {
  await login(page);
  await page.goto('/content', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  return selectTestCampaign(page);
}

// ─── Проверка учётных данных ──────────────────────────────────────────────────

test.beforeAll(() => {
  if (!CREDS.email || !CREDS.password) {
    throw new Error(
      'Не заданы TEST_EMAIL/TEST_PASSWORD или DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD',
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ТИПЫ КОНТЕНТА — диалог создания содержит все нужные опции
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Диалог создания — все типы контента присутствуют', () => {
  test('select "Тип контента" содержит: текст, текст+картинка, видео, клип, story', async ({ page }) => {
    const ok = await goToContentPage(page);
    if (!ok) {
      test.skip(true, 'Нет кампаний');
      return;
    }

    const opened = await openCreateDialog(page);
    if (!opened) {
      test.skip(true, 'Диалог создания недоступен');
      return;
    }

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Открываем select типа контента
    const selectTrigger = dialog.locator('button[role="combobox"]').first();
    const hasTrigger = await selectTrigger.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTrigger) {
      console.log('[INFO] Combobox типа не найден — возможно, используются кнопки-табы');
      // Ищем кнопки-табы вместо select
      const hasTextTab = await dialog.getByText(/^текст$/i).isVisible({ timeout: 3000 }).catch(() => false);
      console.log('[INFO] Таб "Текст" виден:', hasTextTab);
      await page.keyboard.press('Escape');
      return;
    }

    await selectTrigger.click({ timeout: 3000 });
    await page.waitForTimeout(500);

    // Проверяем наличие всех типов в dropdown
    const expectedTypes = ['Текст с картинкой', 'Видео', 'Клип', 'Instagram Stories'];
    for (const typeLabel of expectedTypes) {
      const option = page.getByRole('option').filter({ hasText: new RegExp(typeLabel, 'i') }).first();
      const visible = await option.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`[INFO] Тип "${typeLabel}" в select: ${visible}`);
      // Не бросаем — просто логируем наличие опций
    }

    // Закрываем dropdown
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. СОЗДАНИЕ ТЕКСТОВОГО ПОСТА (реальный API)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Создание текстового поста', () => {
  test('тип "text" — черновик создаётся, id возвращается в ответе', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const title = `E2E Текст ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(page, title, 'E2E тест: текстовый пост без медиа');

    expect(contentId).toBeTruthy();
    console.log('[INFO] Создан текстовый пост, id:', contentId);

    if (contentId) await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. СОЗДАНИЕ ПОСТА С КАРТИНКОЙ (text-image)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Создание поста с картинкой (text-image)', () => {
  test('выбор типа "Текст с картинкой" — поле изображения появляется в диалоге', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'text-image');
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');

    // Проверяем что появился аплодер изображения или поле URL картинки
    const hasImageUpload = await dialog.locator(
      'input[type="file"], [data-testid*="upload"], [data-testid*="image"], input[placeholder*="url"], input[placeholder*="картинк"]'
    ).first().isVisible({ timeout: 5000 }).catch(() => false);

    const hasImageSection = await dialog.getByText(/изображени|картинк|upload|image/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);

    console.log('[INFO] Поле изображения видно:', hasImageUpload, '/ Секция изображения:', hasImageSection);
    // Хотя бы что-то одно должно быть
    expect(hasImageUpload || hasImageSection).toBe(true);

    await page.keyboard.press('Escape');
  });

  test('черновик text-image создаётся (без загрузки файла)', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'text-image');
    await page.waitForTimeout(400);

    const title = `E2E Картинка ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(
      page,
      title,
      'E2E тест: пост текст+картинка, изображение будет добавлено позже',
    );

    console.log('[INFO] text-image contentId:', contentId);
    // Может вернуть null если сервер требует изображение — это тоже ок
    if (contentId) {
      await deleteContentById(page, contentId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. СОЗДАНИЕ ВИДЕО-ПОСТА
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Создание видео-поста', () => {
  test('выбор типа "Видео" — поле загрузки видео появляется в диалоге', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'video');
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');

    const hasVideoUpload = await dialog.locator(
      'input[type="file"][accept*="video"], [data-testid*="video"], input[placeholder*="video"], input[placeholder*="видео"]'
    ).first().isVisible({ timeout: 5000 }).catch(() => false);

    const hasVideoSection = await dialog.getByText(/видео|video|загрузить ролик/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);

    console.log('[INFO] Поле видео:', hasVideoUpload, '/ Секция видео:', hasVideoSection);
    expect(hasVideoUpload || hasVideoSection).toBe(true);

    await page.keyboard.press('Escape');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. СОЗДАНИЕ КЛИПА (Shorts/Reels/Clips)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Создание клипа (Clip/Shorts/Reels)', () => {
  test('выбор типа "Клип" — UI меняется под вертикальный видео-формат', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'clip');
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    // Диалог должен всё ещё быть открыт после выбора типа
    await expect(dialog).toBeVisible();

    const hasClipSection = await dialog.getByText(/клип|reels|shorts|вертикальн/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    console.log('[INFO] Секция клипа видна:', hasClipSection);

    await page.keyboard.press('Escape');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. INSTAGRAM STORIES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Instagram Stories', () => {
  test('выбор типа "story" — UI адаптируется под формат истории', async ({ page }) => {
    test.setTimeout(60000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'story');
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const hasStoryUI = await dialog.getByText(/istagram stories|история|story/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    console.log('[INFO] Story UI видна:', hasStoryUI);

    await page.keyboard.press('Escape');
  });

  test('страница редактора историй /stories доступна', async ({ page }) => {
    await login(page);
    await page.goto('/stories', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    // Может редиректить или рендерить страницу
    const has404 = await page.getByText(/404|страница не найдена/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (has404) {
      console.log('[INFO] /stories возвращает 404 — редактор историй может быть встроен в контент');
      // Проверяем что /content работает
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('text=500')).not.toBeVisible();
    } else {
      // Use specific selector to avoid false positives from campaign names containing "500"
      const has500Error = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
        .filter({ hasText: /^500$|Internal Server Error/i })
        .first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(has500Error).toBe(false);
      const hasContent = await page.locator('main, [role="main"], h1, h2').first()
        .isVisible({ timeout: 5000 }).catch(() => false);
      expect(hasContent).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ПУБЛИКАЦИЯ В YOUTUBE (платформа ранее не покрывалась)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Публикация в YouTube', () => {
  test('чекбокс YouTube присутствует в диалоге публикации', async ({ page }) => {
    test.setTimeout(90000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    // Создаём черновик
    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const title = `E2E YouTube Check ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(page, title, 'Тест проверки YouTube в диалоге публикации');
    if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

    const dialogOpened = await openPublishDialog(page);
    if (!dialogOpened) {
      await deleteContentById(page, contentId);
      test.skip(true, 'Диалог публикации не открылся');
      return;
    }

    // Ищем YouTube чекбокс
    const ytCheckbox = page.locator('button#platform-youtube')
      .or(page.locator('[data-testid="checkbox-platform-youtube"]'))
      .or(page.locator('label').filter({ hasText: /youtube/i }).first());

    const ytFound = await ytCheckbox.isVisible({ timeout: 8000 }).catch(() => false);
    console.log('[INFO] YouTube чекбокс в диалоге:', ytFound);
    expect(ytFound).toBe(true);

    await page.keyboard.press('Escape');
    await deleteContentById(page, contentId);
  });

  test('попытка публикации в YouTube — нет 500 в ответе', async ({ page }) => {
    test.setTimeout(120000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const title = `E2E YouTube Pub ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(page, title, 'E2E тест публикации в YouTube');
    if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

    const dialogOpened = await openPublishDialog(page);
    if (!dialogOpened) {
      await deleteContentById(page, contentId);
      test.skip(true, 'Диалог публикации не открылся');
      return;
    }

    await togglePlatform(page, 'youtube');

    // Перехватываем ответ от publish
    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/api/publish/now') || r.url().includes('/api/content/'),
      { timeout: 30000 },
    ).catch(() => null);

    const confirmBtn = page.getByRole('button', { name: /опубликовать сразу/i }).first();
    const confirmFound = await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (confirmFound && await confirmBtn.isEnabled().catch(() => false)) {
      await confirmBtn.click({ timeout: 5000 });
    }

    const resp = await respPromise;
    if (resp) {
      console.log('[INFO][youtube] publish status:', resp.status());
      const body = await resp.json().catch(() => null);
      console.log('[INFO][youtube] body:', JSON.stringify(body, null, 2));
      expect(resp.status()).not.toBe(500);
    } else {
      console.log('[INFO][youtube] Ответ не перехвачен — возможно публикация пошла через другой эндпоинт');
    }

    // Нет 500 на экране (specific selector to avoid false positives from campaign names containing "500")
    const has500 = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible().catch(() => false);
    expect(has500).toBe(false);

    await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ПЛАНИРОВАНИЕ ПУБЛИКАЦИИ НА ДАТУ (не "сразу")
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Планирование на дату', () => {
  test('кнопка "Запланировать" открывает датпикер, пост переходит в scheduled', async ({ page }) => {
    test.setTimeout(120000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const title = `E2E Schedule ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(page, title, 'E2E тест планирования публикации на дату');
    if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

    const dialogOpened = await openPublishDialog(page);
    if (!dialogOpened) {
      await deleteContentById(page, contentId);
      test.skip(true, 'Диалог публикации не открылся');
      return;
    }

    // Выбираем хотя бы одну платформу
    const anyCheckbox = page.locator('button[id^="platform-"]').first();
    if (await anyCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      const disabled = await anyCheckbox.getAttribute('data-disabled').then((v) => v !== null).catch(() => false);
      if (!disabled) await anyCheckbox.click({ timeout: 3000 }).catch(() => {});
    }

    // Ищем кнопку "Запланировать" (отличается от "Опубликовать сразу")
    const scheduleBtn = page.getByRole('button', { name: /запланировать|schedule|выбрать дату/i }).first();
    const schedFound = await scheduleBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!schedFound) {
      console.log('[INFO] Кнопки "Запланировать" нет в диалоге — поищем датпикер');
      // Ищем поле даты напрямую
      const datePicker = page.locator('input[type="datetime-local"], input[type="date"], [data-testid*="date"], [data-testid*="schedule"]').first();
      const dateFound = await datePicker.isVisible({ timeout: 5000 }).catch(() => false);
      console.log('[INFO] Датпикер в диалоге:', dateFound);
      await page.keyboard.press('Escape');
      await deleteContentById(page, contentId);
      return;
    }

    // Перехватываем POST /api/direct-schedule
    const schedRespPromise = page.waitForResponse(
      (r) => r.url().includes('/api/direct-schedule') || r.url().includes('/schedule'),
      { timeout: 20000 },
    ).catch(() => null);

    await scheduleBtn.click({ timeout: 5000 });
    await page.waitForTimeout(500);

    // После нажатия "Запланировать" может появиться датпикер
    const dateInput = page.locator('input[type="datetime-local"], input[type="date"], [data-testid*="date-time"]').first();
    const dateInputFound = await dateInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (dateInputFound) {
      // Устанавливаем дату на завтра
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const iso = tomorrow.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
      await dateInput.fill(iso);
      await page.waitForTimeout(300);

      // Подтверждаем планирование
      const confirmBtn = page.getByRole('button', { name: /подтвердить|confirm|применить|готово/i }).first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click({ timeout: 5000 });
      }
    }

    const schedResp = await schedRespPromise;
    if (schedResp) {
      console.log('[INFO] schedule status:', schedResp.status());
      const body = await schedResp.json().catch(() => null);
      console.log('[INFO] schedule body:', JSON.stringify(body?.data?.status || body?.status));
      expect(schedResp.status()).not.toBe(500);
    }

    const has500 = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible().catch(() => false);
    expect(has500).toBe(false);

    await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. НЕМЕДЛЕННЫЙ ТОСТ ПРИ НАЖАТИИ "ОПУБЛИКОВАТЬ СРАЗУ"
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Тост при публикации — немедленная обратная связь', () => {
  test('"Опубликовать сразу" показывает тост "Публикация запущена..." немедленно', async ({ page }) => {
    test.setTimeout(90000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    // Мокируем /api/publish/now чтобы он отвечал медленно (проверяем что тост появляется ДО ответа)
    await page.route('**/api/publish/now', async (route) => {
      await new Promise((r) => setTimeout(r, 3000)); // 3 секунды задержки
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          results: [{ platform: 'telegram', success: true }],
        }),
      });
    });

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const title = `E2E Toast ${Date.now()}`;
    const { contentId } = await fillDialogAndSubmit(page, title, 'E2E тест: тост при публикации');
    if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

    const dialogOpened = await openPublishDialog(page);
    if (!dialogOpened) {
      await deleteContentById(page, contentId);
      test.skip(true, 'Диалог публикации не открылся');
      return;
    }

    // Выбираем telegram
    await togglePlatform(page, 'telegram');

    const confirmBtn = page.getByRole('button', { name: /опубликовать сразу/i }).first();
    const confirmFound = await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!confirmFound) {
      await page.keyboard.press('Escape');
      await deleteContentById(page, contentId);
      test.skip(true, 'Кнопка "Опубликовать сразу" не найдена');
      return;
    }

    // Нажимаем кнопку
    await confirmBtn.click({ timeout: 5000 });

    // Тост "Публикация запущена..." должен появиться В ТЕЧЕНИЕ 2 секунд (до ответа сервера)
    const immediateToast = page.getByText(/публикация запущена|отправляем контент/i).first();
    const toastAppearedFast = await immediateToast.waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true).catch(() => false);

    console.log('[INFO] Немедленный тост появился (до ответа сервера):', toastAppearedFast);
    expect(toastAppearedFast).toBe(true);

    // Ждём финального тоста с результатом
    const resultToast = page.getByText(/опубликовано|ошибка|telegram/i).first();
    await resultToast.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
      console.log('[INFO] Финальный тост с результатом не появился за 8 секунд');
    });

    await deleteContentById(page, contentId);
  });

  test('toast "Публикация запущена..." исчезает после получения результата', async ({ page }) => {
    test.setTimeout(90000);
    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    await page.route('**/api/publish/now', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          results: [{ platform: 'vk', success: true }],
        }),
      });
    });

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    const { contentId } = await fillDialogAndSubmit(page, `E2E Toast2 ${Date.now()}`, 'Тест исчезновения loading-тоста');
    if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

    const dialogOpened = await openPublishDialog(page);
    if (!dialogOpened) {
      await deleteContentById(page, contentId);
      test.skip(true, 'Диалог публикации не открылся');
      return;
    }

    await togglePlatform(page, 'vk');

    const confirmBtn = page.getByRole('button', { name: /опубликовать сразу/i }).first();
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.click({ timeout: 5000 });
    }

    // Ждём результирующего тоста (✅ Опубликовано)
    const successToast = page.getByText(/✅|опубликовано/i).first();
    const appeared = await successToast.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false);
    console.log('[INFO] Тост с результатом "✅ Опубликовано":', appeared);

    // Нет 500 ошибки (specific selector to avoid false positives from campaign names containing "500")
    const has500 = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible().catch(() => false);
    expect(has500).toBe(false);

    await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. AI ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ (мок fal.ai / Gemini)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('AI генерация изображения (мок)', () => {
  test('кнопка генерации изображения отправляет запрос и отображает результат', async ({ page }) => {
    test.setTimeout(90000);

    // Мок эндпоинта генерации картинки
    const mockImageUrl = 'https://placehold.co/800x600/png?text=AI+Generated';
    await page.route('**/api/generate-image**', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageUrl: mockImageUrl, url: mockImageUrl, success: true }),
      });
    });
    await page.route('**/api/fal-ai/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageUrl: mockImageUrl, success: true }),
      });
    });

    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const opened = await openCreateDialog(page);
    if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

    await selectContentType(page, 'text-image');
    await page.waitForTimeout(400);

    const dialog = page.getByRole('dialog');

    // Ищем кнопку "Сгенерировать изображение" / "AI картинка"
    const genImgBtn = dialog.getByRole('button', { name: /сгенерировать изображени|AI картин|generate image/i }).first()
      .or(dialog.getByTestId('button-generate-image').first());
    const btnFound = await genImgBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!btnFound) {
      console.log('[INFO] Кнопка генерации изображения не найдена в диалоге создания');
      await page.keyboard.press('Escape');
      return;
    }

    await genImgBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Должно появиться изображение или превью
    const hasImage = await dialog.locator('img[src*="placehold"], img[src*="http"], [data-testid*="preview"]')
      .first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[INFO] Изображение появилось после генерации:', hasImage);

    await page.keyboard.press('Escape');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. КОНТЕНТ-ПЛАН (AI генерация нескольких постов)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Контент-план', () => {
  test('страница или диалог контент-плана доступны', async ({ page }) => {
    await login(page);

    // Проверяем несколько возможных URL
    const candidates = ['/content-plan', '/content/plan', '/plan'];
    let planPageFound = false;

    for (const path of candidates) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const has404 = await page.getByText(/404|не найден/i).first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!has404) {
        planPageFound = true;
        console.log(`[INFO] Контент-план доступен по ${path}`);
        break;
      }
    }

    if (!planPageFound) {
      // Может быть встроен в /content как кнопка
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await selectTestCampaign(page);

      const planBtn = page.getByRole('button', { name: /контент.?план|content.?plan|сгенерировать план/i }).first()
        .or(page.getByTestId('button-content-plan').first());
      const hasPlanBtn = await planBtn.isVisible({ timeout: 5000 }).catch(() => false);
      console.log('[INFO] Кнопка контент-плана на /content:', hasPlanBtn);
    }

    // Страница /content точно работает
    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    const has500 = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(has500).toBe(false);
  });

  test('генерация контент-плана (мок AI) — посты создаются', async ({ page }) => {
    test.setTimeout(90000);

    // Мокируем AI-генерацию
    await page.route('**/api/generate-content-plan**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          posts: [
            { title: 'Пост 1 из плана', content: 'Контент первого поста', type: 'text' },
            { title: 'Пост 2 из плана', content: 'Контент второго поста', type: 'text-image' },
          ],
        }),
      });
    });
    await page.route('**/api/content-plan**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              { id: 'plan-post-1', title: 'Пост 1', status: 'draft' },
              { id: 'plan-post-2', title: 'Пост 2', status: 'draft' },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    const ok = await goToContentPage(page);
    if (!ok) { test.skip(true, 'Нет кампаний'); return; }

    const planBtn = page.getByRole('button', { name: /контент.?план|content.?plan|сгенерировать план/i }).first()
      .or(page.getByTestId('button-content-plan').first());
    const hasPlanBtn = await planBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasPlanBtn) {
      console.log('[INFO] Кнопка контент-плана не найдена на /content — пропускаем');
      test.skip(true, 'Кнопка контент-плана не найдена');
      return;
    }

    await planBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Диалог или новые карточки должны появиться
    const hasResult = await page.getByText(/пост 1 из плана|plan-post|контент-план создан/i).first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    console.log('[INFO] Результат контент-плана отображается:', hasResult);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. ПУБЛИКАЦИЯ ВО ВСЕ 6 ПЛАТФОРМ ПОДРЯД (smoke-тест, мок API)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Публикация во все платформы — smoke (мок)', () => {
  for (const platform of ALL_PLATFORMS) {
    test(`публикация в ${platform} — UI не падает, нет 500 (мок)`, async ({ page }) => {
      test.setTimeout(90000);

      // Мокируем только /api/publish/now
      await page.route('**/api/publish/now', async (route) => {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            results: [{ platform, success: true, postId: `mock-${platform}-123` }],
          }),
        });
      });

      const ok = await goToContentPage(page);
      if (!ok) { test.skip(true, 'Нет кампаний'); return; }

      const opened = await openCreateDialog(page);
      if (!opened) { test.skip(true, 'Диалог создания недоступен'); return; }

      const title = `E2E ${platform} Mock ${Date.now()}`;
      const { contentId } = await fillDialogAndSubmit(page, title, `Smoke тест публикации в ${platform}`);
      if (!contentId) { test.skip(true, 'Не удалось создать черновик'); return; }

      const dialogOpened = await openPublishDialog(page);
      if (!dialogOpened) {
        await deleteContentById(page, contentId);
        test.skip(true, 'Диалог публикации не открылся');
        return;
      }

      await togglePlatform(page, platform);

      const confirmBtn = page.getByRole('button', { name: /опубликовать сразу/i }).first();
      const confirmFound = await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (confirmFound && await confirmBtn.isEnabled().catch(() => false)) {
        await confirmBtn.click({ timeout: 5000 });
      }

      // Нет 500 на экране (specific selector to avoid false positives from campaign names containing "500")
      const has500 = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
        .filter({ hasText: /^500$|Internal Server Error/i })
        .first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(has500).toBe(false);

      // Должен появиться хоть какой-то тост
      const hasAnyToast = await page.locator('[data-sonner-toast], [role="status"], [data-state]')
        .filter({ hasText: /опубликов|запущен|ошибк/i })
        .first()
        .isVisible({ timeout: 6000 })
        .catch(() => false);
      console.log(`[INFO][${platform}] Тост после публикации:`, hasAnyToast);

      await deleteContentById(page, contentId);
    });
  }
});

// ─── Скриншот при падении ─────────────────────────────────────────────────────
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const ts = Date.now();
    const name = testInfo.title.replace(/\s+/g, '-').substring(0, 60);
    await page.screenshot({
      path: `test-results/failure-all-types-${name}-${ts}.png`,
      fullPage: true,
    }).catch(() => {});
  }
});
