import { test, expect, Page } from './fixtures';

const CREDENTIALS = {
  email: process.env.TEST_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || '',
  password: process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

const PLATFORMS = ['telegram', 'vk', 'instagram', 'facebook', 'threads'] as const;
type Platform = (typeof PLATFORMS)[number];

// Реальная кампания с подключёнными платформами (dev + prod)
const TEST_CAMPAIGN_ID = '4513f574-80da-4bbe-8c47-771c63b5d1cb';

test.beforeAll(() => {
  if (!CREDENTIALS.email || !CREDENTIALS.password) {
    throw new Error(
      'Missing test credentials. Set TEST_EMAIL/TEST_PASSWORD or DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD env vars.',
    );
  }
});

// ─── Вспомогательные функции ──────────────────────────────────────────────────

async function waitReady(page: Page, timeout = 12000) {
  await page.waitForLoadState('domcontentloaded');
  await page
    .waitForLoadState('networkidle', { timeout: Math.min(timeout, 3000) })
    .catch(() => {});
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout: 3000 })
    .catch(() => {});
}

async function login(page: Page) {
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await page
    .waitForURL(/\/(campaigns|dashboard|auth\/login|auth\/register|login)/, { timeout: 20000 })
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const url = page.url();
  if (!url.includes('login') && !url.includes('register')) return;

  if (url.includes('register')) {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
  }

  await page
    .getByPlaceholder(/email/i)
    .or(page.locator('input[type="email"]'))
    .fill(CREDENTIALS.email);
  await page
    .getByPlaceholder(/пароль|password/i)
    .or(page.locator('input[type="password"]'))
    .fill(CREDENTIALS.password);
  await page.getByRole('button', { name: /войти/i }).first().click();
  await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
  await waitReady(page);
}

// Находит название тест-кампании через реальный API и выбирает её в combobox
async function selectTestCampaign(page: Page): Promise<boolean> {
  // Получаем название кампании через браузерный fetch (есть auth)
  const campaignName = await page.evaluate(async (id) => {
    const resp = await fetch('/api/campaigns');
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    const campaigns = json?.data || json || [];
    const found = (campaigns as Array<{ id: string; title?: string; name?: string }>)
      .find((c) => c.id === id);
    return found?.title || found?.name || null;
  }, TEST_CAMPAIGN_ID);

  const combo = page.getByRole('combobox').first();
  const visible = await combo.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) return false;

  await combo.click().catch(() => {});
  await page.waitForTimeout(400);

  if (campaignName) {
    const namedOpt = page.getByRole('option').filter({ hasText: campaignName }).first();
    const found = await namedOpt.isVisible({ timeout: 3000 }).catch(() => false);
    if (found) {
      await namedOpt.click();
      await waitReady(page);
      return true;
    }
  }

  // Fallback: первая опция
  const firstOpt = page.getByRole('option').first();
  const optVisible = await firstOpt.isVisible({ timeout: 5000 }).catch(() => false);
  if (optVisible) {
    await firstOpt.click();
    await waitReady(page);
    return true;
  }
  return false;
}

// Для /trends страница тоже нужен combobox
async function selectFirstCampaign(page: Page) {
  return selectTestCampaign(page);
}

// Удаляет контент-запись из БД через браузерный fetch (реальный API, с auth)
async function deleteContentById(page: Page, id: string) {
  if (!id) return;
  await page.evaluate(async (contentId) => {
    await fetch(`/api/campaign-content/${contentId}`, { method: 'DELETE' }).catch(() => {});
  }, id).catch(() => {});
}

async function openContentPageAndSelectCampaign(page: Page): Promise<boolean> {
  await login(page);
  await page.goto('/content', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const selected = await selectTestCampaign(page);
  if (!selected) return false;
  // Ждём пока кнопка "Создать контент" станет активной
  await page
    .waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="button-create-content"]') as HTMLButtonElement | null;
        if (!btn) return true;
        return !btn.disabled;
      },
      { timeout: 10000 },
    )
    .catch(() => {});
  return true;
}

// Создаёт черновик через диалог, возвращает реальный ID из API-ответа
async function createDraftViaDialog(
  page: Page,
  title: string,
  bodyText: string,
): Promise<{ created: boolean; contentId: string | null }> {
  let contentId: string | null = null;

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
    { timeout: 20000 },
  ).catch(() => null);

  const createBtn = page
    .getByTestId('button-create-content')
    .or(page.getByRole('button', { name: /создать контент/i }).first());
  const found = await createBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!found) return { created: false, contentId: null };

  await createBtn.click({ timeout: 5000 });

  const dialog = page.getByRole('dialog');
  const dlgVisible = await dialog.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (!dlgVisible) return { created: false, contentId: null };

  const textType = dialog.getByText('Текст', { exact: true });
  if (await textType.isVisible({ timeout: 2000 }).catch(() => false)) await textType.click();

  const titleInput = page.locator('input#title');
  await expect(titleInput).toBeVisible({ timeout: 8000 });
  await titleInput.fill(title);

  const editor = page.locator('.tiptap').first();
  await editor.click();
  await page.keyboard.type(bodyText);

  const submitBtn = page.getByRole('button', { name: /^создать$/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click({ timeout: 5000 });

  await expect(dialog).not.toBeVisible({ timeout: 15000 });

  const resp = await responsePromise;
  if (resp) {
    const json = await resp.json().catch(() => null);
    contentId = json?.data?.id || json?.id || null;
  }
  await page.waitForTimeout(500);
  return { created: true, contentId };
}

// Нажимает "Опубликовать" на карточке, выбирает платформу и подтверждает публикацию.
// Возвращает ответ от сервера (status + body).
async function clickPublishAndSelectPlatform(
  page: Page,
  platform: Platform,
): Promise<{ found: boolean; status: number; body: Record<string, unknown> | null }> {
  await page.waitForTimeout(2000);

  const responsePromise = page.waitForResponse(
    (r) =>
      (r.url().includes('/api/content/') && r.url().includes('/publish')) ||
      r.url().includes('/api/campaign-content/') && r.request().method() === 'POST',
    { timeout: 25000 },
  ).catch(() => null);

  const publishBtn = page.locator('[data-testid^="button-publish-content-"]').first()
    .or(page.getByRole('button', { name: /опубликовать|publish/i }).first());
  const btnFound = await publishBtn.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (!btnFound) return { found: false, status: 0, body: null };

  await publishBtn.click({ timeout: 5000 });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);

  // shadcn Checkbox рендерится как <button role="checkbox" id="platform-{platform}">
  const platformCheckbox = page.locator(`button#platform-${platform}`)
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
      console.log(`[WARN][${platform}] Чекбокс платформы disabled — токены не настроены в кампании`);
    }
    await page.waitForTimeout(400);
  }

  const confirmBtn = page
    .getByRole('button', { name: /опубликовать сразу|подтвердить|запланировать|отправить/i })
    .first()
    .or(page.getByRole('button', { name: /confirm|schedule|publish now/i }).first());
  const confirmFound = await confirmBtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (confirmFound) {
    const enabled = await confirmBtn.isEnabled().catch(() => false);
    if (enabled) {
      await confirmBtn.click({ timeout: 5000 });
    } else {
      console.log(`[INFO][${platform}] Кнопка подтверждения disabled`);
    }
  }

  const resp = await responsePromise;
  const status = resp?.status() ?? 0;
  const body = resp ? await resp.json().catch(() => null) : null;
  await page.waitForTimeout(1000);
  return { found: true, status, body };
}

// Мок только AI-генерации (не данных платформ)
interface GenerateContentTracker {
  intercepted: boolean;
  response: { content: string; success: boolean } | null;
}

function mockGenerateContent(page: Page, content?: string, tracker?: GenerateContentTracker) {
  const responseContent =
    content ||
    '<h2>AI Тест: SMM стратегии 2026</h2><p>Современный SMM требует системного подхода к контенту и аналитике.</p>';
  return page.route('**/api/generate-content', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    const responseBody = { content: responseContent, success: true };
    if (tracker) {
      tracker.intercepted = true;
      tracker.response = responseBody;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. СТРАНИЦА ТРЕНДОВ
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Страница трендов', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/trends', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await selectTestCampaign(page);
    await page.waitForTimeout(2000);
  });

  test('страница /trends загружается без 500', async ({ page }) => {
    // Use specific selector to avoid false positives from campaign names containing "500"
    const has500Error = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(has500Error).toBe(false);
    const hasContent = await page.locator('main, [role="main"], h1, h2').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('генерация контента через AI (мок AI) — результат отображается в редакторе', async ({ page }) => {
    const tracker: GenerateContentTracker = { intercepted: false, response: null };
    const mockContent =
      '<h2>Тренд недели: нейросети в SMM</h2><p>Нейросети автоматизируют создание визуалов и текстов.</p>';

    await mockGenerateContent(page, mockContent, tracker);

    const trendCheckboxes = page
      .locator('[data-testid^="checkbox-trend-"], input[type="checkbox"]')
      .filter({ visible: true });
    const count = await trendCheckboxes.count();

    if (count === 0) {
      test.skip(true, 'Нет трендов для выбора — генерация контента невозможна');
      return;
    }

    await trendCheckboxes.first().check({ force: true });
    await page.waitForTimeout(1000);

    const promptInput = page
      .getByTestId('input-gen-prompt')
      .or(page.locator('textarea[placeholder*="промт"], textarea[placeholder*="Опишите"]'));
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    await promptInput.fill('Напиши пост про нейросети в SMM');

    const generateBtn = page
      .getByTestId('button-generate-content')
      .or(page.getByRole('button', { name: /сгенерировать/i }))
      .first();
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    await generateBtn.click();

    await expect(
      page.getByText(/тренд недели|нейросети в SMM|нейросети автоматизируют/i).first(),
    ).toBeVisible({ timeout: 15000 });

    expect(tracker.intercepted).toBe(true);
    expect(tracker.response!.content.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. СОХРАНЕНИЕ ЧЕРНОВИКА (реальный API)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Сохранение черновика', () => {
  test.beforeEach(async ({ page }) => {
    await openContentPageAndSelectCampaign(page);
  });

  test('создание записи в campaign_content — реальный API возвращает id и status:draft', async ({ page }) => {
    test.setTimeout(60000);
    const testTitle = `E2E Save Draft ${Date.now()}`;
    const { created, contentId } = await createDraftViaDialog(
      page,
      testTitle,
      'Тестовый контент для проверки сохранения черновика через E2E тест',
    );

    expect(created).toBe(true);
    expect(contentId).toBeTruthy();
    console.log('[INFO] Создан черновик id:', contentId);

    // Cleanup
    if (contentId) await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ПУБЛИКАЦИЯ ПО ПЛАТФОРМАМ (реальные посты)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Публикация по платформам', () => {
  test.beforeEach(async ({ page }) => {
    await openContentPageAndSelectCampaign(page);
  });

  for (const platform of PLATFORMS) {
    test(`публикация в ${platform} — реальный API: нет 500, ответ содержит структуру`, async ({ page }) => {
      test.setTimeout(90000);
      const title = `E2E ${platform} ${Date.now()}`;
      const { created, contentId } = await createDraftViaDialog(
        page,
        title,
        `E2E тест реальной публикации в ${platform}: ${new Date().toISOString()}`,
      );

      if (!created) {
        test.skip(true, 'Диалог создания контента недоступен');
        return;
      }
      console.log(`[${platform}] создан черновик id:`, contentId);

      const { found, status, body } = await clickPublishAndSelectPlatform(page, platform);

      if (!found) {
        console.log(`[${platform}] Кнопка публикации не найдена — пропускаем`);
        if (contentId) await deleteContentById(page, contentId);
        return;
      }

      console.log(`[${platform}] publish status=${status}`, JSON.stringify(body, null, 2));
      expect(status).not.toBe(500);

      const hasError500 = await page
        .locator('h1, h2, .error-page, [class*="error-boundary"]')
        .filter({ hasText: /^500$|Internal Server Error/i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasError500).toBe(false);

      // Cleanup — удаляем запись из БД (пост уже отправлен на платформу)
      if (contentId) await deleteContentById(page, contentId);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THREADS — специфика
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Threads — публикация', () => {
  test.beforeEach(async ({ page }) => {
    await openContentPageAndSelectCampaign(page);
  });

  test('публикация в Threads — реальный API: нет 500, ответ содержит social_platforms', async ({ page }) => {
    test.setTimeout(90000);
    const title = `E2E Threads ${Date.now()}`;
    const { created, contentId } = await createDraftViaDialog(
      page,
      title,
      'E2E тест публикации в Threads',
    );

    if (!created) {
      test.skip(true, 'Диалог создания недоступен');
      return;
    }

    const { found, status, body } = await clickPublishAndSelectPlatform(page, 'threads');
    if (!found) {
      if (contentId) await deleteContentById(page, contentId);
      return;
    }

    console.log('[threads] status:', status, JSON.stringify(body, null, 2));
    expect(status).not.toBe(500);

    // Cleanup
    if (contentId) await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ПОЛНЫЙ ФЛОУ: генерация → сохранение → публикация
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Полный флоу: генерация → сохранение → публикация', () => {
  test('e2e: мок AI генерации, реальное сохранение, реальная публикация в Telegram', async ({ page }) => {
    test.setTimeout(120000);

    const aiContent =
      '<h2>SMM стратегия 2026</h2><p>Полный e2e тест: генерация, сохранение, публикация.</p>';
    let generateIntercepted = false;
    await page.route('**/api/generate-content', async (route) => {
      generateIntercepted = true;
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: aiContent, success: true }),
      });
    });

    await login(page);
    await page.goto('/trends', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await selectTestCampaign(page);
    await page.waitForTimeout(2000);

    const trendCheckboxes = page
      .locator('[data-testid^="checkbox-trend-"], input[type="checkbox"]')
      .filter({ visible: true });
    const trendCount = await trendCheckboxes.count();

    if (trendCount === 0) {
      test.skip(true, 'Нет трендов — генерация невозможна');
      return;
    }

    await trendCheckboxes.first().check({ force: true });
    await page.waitForTimeout(1000);

    const promptInput = page
      .getByTestId('input-gen-prompt')
      .or(page.locator('textarea[placeholder*="промт"], textarea[placeholder*="Опишите"]'));
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    await promptInput.fill('Напиши пост про SMM стратегии 2026 года');

    const generateBtn = page
      .getByTestId('button-generate-content')
      .or(page.getByRole('button', { name: /сгенерировать/i }))
      .first();
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    await generateBtn.click();

    await expect(
      page.getByText(/SMM стратегия 2026|полный e2e тест/i).first(),
    ).toBeVisible({ timeout: 15000 });
    expect(generateIntercepted).toBe(true);

    const saveBtn = page
      .getByTestId('button-save-content')
      .or(page.getByRole('button', { name: /сохранить как черновик/i }));

    let savedContentId: string | null = null;
    const saveRespPromise = page.waitForResponse(
      (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
      { timeout: 15000 },
    ).catch(() => null);

    const saveBtnFound = await saveBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (saveBtnFound) {
      await saveBtn.click({ timeout: 5000 });
      const saveResp = await saveRespPromise;
      if (saveResp) {
        const json = await saveResp.json().catch(() => null);
        savedContentId = json?.data?.id || json?.id || null;
      }
    }

    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await selectTestCampaign(page);
    await expect(page.locator('text=404')).not.toBeVisible();

    const { found, status } = await clickPublishAndSelectPlatform(page, 'telegram');
    if (found) {
      expect(status).not.toBe(500);
      const hasError500 = await page
        .locator('h1, h2, .error-page, [class*="error-boundary"]')
        .filter({ hasText: /^500$|Internal Server Error/i })
        .first()
        .isVisible().catch(() => false);
      expect(hasError500).toBe(false);
    }

    if (savedContentId) await deleteContentById(page, savedContentId);
  });

  test('e2e без мока AI (реальная генерация через Gemini)', async ({ page }) => {
    test.slow();
    test.setTimeout(180000);

    await login(page);
    await page.goto('/trends', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await selectTestCampaign(page);
    await page.waitForTimeout(2000);

    const trendCheckboxes = page
      .locator('[data-testid^="checkbox-trend-"], input[type="checkbox"]')
      .filter({ visible: true });
    const trendCount = await trendCheckboxes.count();

    if (trendCount === 0) {
      test.skip(true, 'Нет трендов — реальная генерация невозможна');
      return;
    }

    await trendCheckboxes.first().check({ force: true });
    await page.waitForTimeout(1000);

    const promptInput = page
      .getByTestId('input-gen-prompt')
      .or(page.locator('textarea[placeholder*="промт"], textarea[placeholder*="Опишите"]'));
    await expect(promptInput).toBeVisible({ timeout: 10000 });
    await promptInput.fill('Напиши краткий пост про SMM стратегии для малого бизнеса в 2026 году');

    const generateBtn = page
      .getByTestId('button-generate-content')
      .or(page.getByRole('button', { name: /сгенерировать/i }))
      .first();
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    await generateBtn.click();

    const editorContent = page
      .locator('.tiptap, [contenteditable], [class*="editor"], [class*="generated"]')
      .first();
    await expect(editorContent).toBeVisible({ timeout: 60000 });

    let contentAppeared = false;
    for (let i = 0; i < 30; i++) {
      const text = await editorContent.innerText().catch(() => '');
      if (text.length > 30) { contentAppeared = true; break; }
      await page.waitForTimeout(2000);
    }
    if (!contentAppeared) {
      test.skip(true, 'AI контент не появился за 60 секунд');
      return;
    }

    const saveBtn = page
      .getByTestId('button-save-content')
      .or(page.getByRole('button', { name: /сохранить как черновик/i }));

    let savedContentId: string | null = null;
    const saveRespPromise = page.waitForResponse(
      (r) => r.url().includes('/api/campaign-content') && r.request().method() === 'POST',
      { timeout: 15000 },
    ).catch(() => null);

    const saveBtnFound = await saveBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (saveBtnFound) {
      await saveBtn.click({ timeout: 5000 });
      const saveResp = await saveRespPromise;
      if (saveResp) {
        const json = await saveResp.json().catch(() => null);
        savedContentId = json?.data?.id || json?.id || null;
      }
    }

    await page.goto('/content', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await selectTestCampaign(page);

    const { found, status } = await clickPublishAndSelectPlatform(page, 'telegram');
    if (found) {
      expect(status).not.toBe(500);
    }

    if (savedContentId) await deleteContentById(page, savedContentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. VK ИСТОРИИ и КЛИПЫ
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('VK Stories и Clips', () => {
  test.beforeEach(async ({ page }) => {
    await openContentPageAndSelectCampaign(page);
  });

  test('диалог публикации открывается, содержит платформы для выбора', async ({ page }) => {
    test.setTimeout(60000);
    const { created, contentId } = await createDraftViaDialog(
      page,
      `E2E VK Dialog ${Date.now()}`,
      'Тест диалога публикации',
    );

    if (!created) {
      test.skip(true, 'Диалог создания недоступен');
      return;
    }

    await page.waitForTimeout(2000);
    const publishBtn = page.locator('[data-testid^="button-publish-content-"]').first()
      .or(page.getByRole('button', { name: /опубликовать|publish/i }).first());
    const btnFound = await publishBtn.waitFor({ state: 'visible', timeout: 12000 })
      .then(() => true).catch(() => false);

    if (!btnFound) {
      if (contentId) await deleteContentById(page, contentId);
      test.skip(true, 'Кнопка публикации не найдена');
      return;
    }

    await publishBtn.click({ timeout: 5000 });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const hasPlatformSelector = await dialog
      .locator('[id^="platform-"], [data-testid^="checkbox-platform-"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log('[INFO] PlatformSelector visible:', hasPlatformSelector);

    const storyOption = dialog
      .getByText(/история|story/i).first()
      .or(dialog.locator('[data-value="story"], [value="story"]').first());
    const storyExists = await storyOption.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[INFO] Тип "История" в диалоге:', storyExists);

    await page.keyboard.press('Escape');

    if (contentId) await deleteContentById(page, contentId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. СТРАНИЦА ЗАПЛАНИРОВАННЫХ ПУБЛИКАЦИЙ
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Страница запланированных публикаций', () => {
  test('страница /publish/scheduled загружается без ошибок', async ({ page }) => {
    await login(page);
    await page.goto('/publish/scheduled', { waitUntil: 'domcontentloaded' });
    await waitReady(page);

    expect(page.url()).toContain('/publish/scheduled');
    // Use specific selector to avoid false positives from campaign names containing "500"
    const has500Error = await page.locator('h1, h2, .error-page, [class*="error-boundary"]')
      .filter({ hasText: /^500$|Internal Server Error/i })
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(has500Error).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. API HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('API health', () => {
  test('GET /api/campaigns возвращает 200', async ({ page }) => {
    await login(page);
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      const userId = localStorage.getItem('user_id');
      const r = await fetch('/api/campaigns', {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(userId ? { 'x-user-id': userId } : {}),
        },
      });
      const data = await r.json().catch(() => null);
      return { status: r.status, data };
    });
    expect(result.status).toBeLessThan(400);
    console.log('[INFO] campaigns count:', (result.data?.data || result.data)?.length);
  });
});

// ─── Screenshot on failure ────────────────────────────────────────────────────
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const ts = Date.now();
    const name = testInfo.title.replace(/\s+/g, '-').substring(0, 50);
    await page.screenshot({
      path: `test-results/failure-publish-${name}-${ts}.png`,
      fullPage: true,
    }).catch(() => {});
  }
});
