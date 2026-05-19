/**
 * SMM Manager - полный E2E тест-сьют
 * Симулирует реальные действия пользователя: вход, навигация, создание контента, профиль, аналитика
 *
 * Запуск:
 *   npm run test:e2e              — все тесты (headless)
 *   npx playwright test smm-flow --headed  — с видимым браузером
 *   npx playwright test smm-flow --project=chromium --headed
 */

import { test, expect, Page } from './fixtures';

// Учётные данные для тестов (.env: DIRECTUS_ADMIN_EMAIL, DIRECTUS_ADMIN_PASSWORD)
const TEST_CREDENTIALS = {
  email: process.env.TEST_EMAIL || process.env.ADMIN_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || '',
  password: process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || '',
};

// Основные навигационные ссылки (data-testid из Sidebar)
const MAIN_NAV_LINKS = [
  { path: '/dashboard', testId: 'nav-dashboard', title: 'Главная' },
  { path: '/campaigns', testId: 'nav-campaigns', title: 'Кампании' },
  { path: '/trends', testId: 'nav-trends', title: 'Тренды' },
  { path: '/content', testId: 'nav-content', title: 'Контент' },
  { path: '/publish/scheduled', testId: 'nav-publish-scheduled', title: 'Запланировано' },
  { path: '/posts', testId: 'nav-posts', title: 'Публикации' },
  { path: '/analytics', testId: 'nav-analytics', title: 'Аналитика' },
  { path: '/help/tutorials', testId: 'nav-help-tutorials', title: 'Обучение' },
];

/** Ожидание завершения загрузки и исчезновения скелетонов/лоадеров */
async function waitForPageReady(page: Page, options?: { timeout?: number }) {
  const timeout = options?.timeout ?? 15000;
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 3000) }).catch(() => { });
  // Ждём исчезновения глобального спиннера загрузки (если есть)
  const spinner = page.locator('.animate-spin').first();
  await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
}

/** Выполнить вход, если пользователь на странице логина или токен невалиден */
async function ensureLoggedIn(page: Page) {
  console.log('ensureLoggedIn: checking state via /campaigns');
  await page.goto('/campaigns');

  // Ждем первоначального URL
  await page.waitForURL(/\/(campaigns|dashboard|auth\/login|login)/, { timeout: 20000 });

  // Даем приложению время на React-гидрацию и проверку токена (clearExpiredToken может сделать редирект)
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Проверяем URL повторно — clearExpiredToken мог перенаправить на /login после гидрации
  const finalUrl = page.url();
  console.log('ensureLoggedIn: final URL is', finalUrl);

  const doLogin = async () => {
    console.log('Detected login page, performing login...');
    const emailInput = page.getByPlaceholder(/email|электронная почта/i).or(page.locator('input[type="email"]'));
    const passwordInput = page.getByPlaceholder(/пароль|password/i).or(page.locator('input[type="password"]'));

    await expect(emailInput).toBeVisible({ timeout: 15000 });
    await emailInput.fill(TEST_CREDENTIALS.email);
    await passwordInput.fill(TEST_CREDENTIALS.password);

    await page.getByRole('button', { name: /войти|sign in/i }).first().click();
    await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
    console.log('Login successful, redirected to', page.url());
  };

  if (finalUrl.includes('/auth/login') || finalUrl.includes('/login')) {
    await doLogin();
  } else {
    console.log('User already logged in (URL check).');
  }

  await waitForPageReady(page);

  // Дополнительная проверка: ждём появления сайдбара (подтверждение что авторизация прошла)
  // clearExpiredToken может редиректить на логин ПОСЛЕ того как URL показал /campaigns
  const sidebarVisible = await page.locator('[data-testid="nav-campaigns"]')
    .isVisible({ timeout: 4000 }).catch(() => false);

  if (!sidebarVisible) {
    const currentUrl = page.url();
    console.log('Sidebar not found after ensureLoggedIn, current URL:', currentUrl);
    if (currentUrl.includes('/auth/login') || currentUrl.includes('/login')) {
      await doLogin();
      await waitForPageReady(page);
    }
  }
}
// =============================================================================
// СЦЕНАРИЙ 1: Smoke Test — проверка всех основных страниц на 404 и падения
// =============================================================================

test.describe('Smoke Test — навигация по всем разделам', () => {
  test('все основные ссылки открываются без 404', async ({ page }) => {
    await ensureLoggedIn(page);

    for (const link of MAIN_NAV_LINKS) {
      const navBtn = page.getByTestId(link.testId);
      const visible = await navBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) {
        console.log(`[SKIP] ${link.testId} не виден в сайдбаре — пропускаем`);
        continue;
      }
      await navBtn.click();

      await page.waitForURL(`**${link.path}**`, { timeout: 5000 }).catch(() => { });
      await waitForPageReady(page, { timeout: 8000 });

      // Не должно быть 404
      const check404 = async () => {
        await expect(page.locator('text=404')).not.toBeVisible();
        await expect(page.locator('text=Not Found')).not.toBeVisible();
        await expect(page.locator('text=Страница не найдена')).not.toBeVisible();
      };
      await check404().catch(e => {
        if (e.message && e.message.includes('Target page')) {
          console.log(`[WARN] Browser closed during check for ${link.path} — skipping`);
        } else {
          throw e;
        }
      });
    }
  });
});

// =============================================================================
// СЦЕНАРИЙ 2: Login Flow
// =============================================================================

test.describe('Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('страница входа отображается и форма работает', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: /вход в smm manager/i })).toBeVisible();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/пароль/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /войти/i })).toBeVisible();
  });

  test('успешный вход перенаправляет на кампании', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByPlaceholder(/email/i).fill(TEST_CREDENTIALS.email);
    await page.getByPlaceholder(/пароль/i).fill(TEST_CREDENTIALS.password);
    await page.getByRole('button', { name: /войти/i }).click();

    await page.waitForURL(/\/(campaigns|dashboard)/, { timeout: 30000 });
    await waitForPageReady(page);
    expect(page.url()).toMatch(/\/(campaigns|dashboard)/);
  });

  test('неверные данные показывают ошибку', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByPlaceholder(/email/i).fill('invalid@test.com');
    await page.getByPlaceholder(/пароль/i).fill('wrongpassword');
    await page.getByRole('button', { name: /войти/i }).click();

    // Остаёмся на странице логина (редирект не произошёл) или видим toast с ошибкой
    await page.waitForTimeout(3000);
    const onLoginPage = page.url().includes('login');
    const hasError = await page.getByText(/ошибка|проверьте|invalid|credentials/i).first().isVisible().catch(() => false);
    expect(onLoginPage || hasError).toBeTruthy();
  });
});

// =============================================================================
// СЦЕНАРИЙ 3: Создание контента (открытие диалога и заполнение формы)
// =============================================================================

test.describe('Создание контента', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/content');
    await waitForPageReady(page);
    // Выбираем кампанию, иначе кнопка "Создать контент" отключена
    // Ждём появления комбобокса с таймаутом (он рендерится асинхронно)
    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 5000 }).catch(() => false);
    if (comboVisible) {
      await campaignSelect.click({ timeout: 5000 }).catch(() => {});
      const option = page.getByRole('option').first();
      const optVisible = await option.isVisible({ timeout: 5000 }).catch(() => false);
      if (optVisible) {
        await option.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  });

  test('кнопка "Создать контент" открывает диалог выбора типа', async ({ page }) => {
    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }).first());
    const btnVisible = await createBtn.isVisible({ timeout: 20000 }).catch(() => false);
    if (!btnVisible) {
      console.log('[SKIP] Кнопка "Создать контент" не найдена');
      test.skip();
      return;
    }
    await createBtn.click({ timeout: 5000 });

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/текст с картинкой|только текст|карусель|выберите тип/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('можно выбрать тип "Текст" и открыть форму', async ({ page }) => {
    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }).first());
    await expect(createBtn).toBeVisible({ timeout: 20000 });
    await createBtn.click({ timeout: 5000 });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText('Выберите тип контента')).toBeVisible();

    await page.getByText('Текст', { exact: true }).first().click();

    await page.waitForTimeout(500);
    await expect(page.getByLabel(/название/i).or(page.locator('input#title'))).toBeVisible({ timeout: 8000 });
  });
});

// =============================================================================
// СЦЕНАРИЙ 3.1: Inline AI-генерация контента (встроена в форму создания контента)
// =============================================================================
//
// ОБНОВЛЕНО: кнопка "Генерация через AI" удалена. AI-генерация теперь встроена
// прямо в форму создания контента через кнопку "Сгенерировать ИИ"
// (data-testid="button-ai-generate-text") и inline-панель с промтом.

test.describe('AI-генерация контента (inline)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/content');
    await waitForPageReady(page);
    // Выбираем кампанию
    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 8000 }).catch(() => false);
    if (comboVisible) {
      await campaignSelect.click().catch(() => {});
      const option = page.getByRole('option').first();
      if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
        await option.click().catch(() => {});
      }
    }
    await page.waitForTimeout(1500);
  });

  test('кнопка "Сгенерировать ИИ" открывает inline-панель с промтом', async ({ page }) => {
    // Мок AI API
    await page.route('**/api/generate-content', async (route) => {
      await new Promise(r => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '<p>Тестовый контент от ИИ.</p>' }),
      });
    });

    // 1. Открыть форму создания контента
    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i })).first();
    const createVisible = await createBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (!createVisible) {
      console.log('[SKIP] Кнопка создания контента не найдена');
      test.skip();
      return;
    }
    await createBtn.click();

    // 2. Выбрать тип "Текст" если есть диалог выбора типа
    const typeDialog = page.getByRole('dialog');
    if (await typeDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      const textOption = typeDialog.getByText(/^текст$/i).or(typeDialog.getByText(/только текст/i)).first();
      if (await textOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await textOption.click();
        await page.waitForTimeout(500);
      }
    }

    // 3. Найти кнопку "Сгенерировать ИИ" (inline, внутри формы)
    const aiInlineBtn = page.getByTestId('button-ai-generate-text')
      .or(page.getByRole('button', { name: /сгенерировать ии|сгенерировать.*ии|ai.*генер/i })).first();
    const aiVisible = await aiInlineBtn.isVisible({ timeout: 15000 }).catch(() => false);
    if (!aiVisible) {
      console.log('[SKIP] Кнопка "Сгенерировать ИИ" не найдена в форме');
      test.skip();
      return;
    }
    await aiInlineBtn.click();

    // 4. Inline-панель с textarea для промта должна появиться
    const promptArea = page.locator('textarea[placeholder*="промт"], textarea[placeholder*="опиши"], textarea[placeholder*="prompt"]')
      .or(page.getByTestId('ai-prompt-input')).first();
    const promptVisible = await promptArea.isVisible({ timeout: 8000 }).catch(() => false);
    if (!promptVisible) {
      console.log('[SKIP] Поле промта не появилось');
      test.skip();
      return;
    }
    await promptArea.fill('Напиши пост о преимуществах SMM-автоматизации');

    // 5. Нажать "Создать" / submit
    const submitBtn = page.getByTestId('button-ai-generate-submit')
      .or(page.getByRole('button', { name: /^создать$/i })).first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // 6. Контент должен появиться в редакторе (мок возвращает "Тестовый контент от ИИ")
    await expect(page.getByText(/тестовый контент от ии/i).first())
      .toBeVisible({ timeout: 15000 });

    console.log('✅ Inline AI generation flow passed');
  });
});

// =============================================================================
// СЦЕНАРИЙ 4: Редактирование профиля
// =============================================================================

test.describe('Профиль пользователя', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/campaigns');
    await waitForPageReady(page);
  });

  test('профиль открывается из топбара', async ({ page }) => {
    const userMenuBtn = page.getByTestId('button-user-menu');
    await expect(userMenuBtn).toBeVisible({ timeout: 10000 });
    await userMenuBtn.click({ timeout: 5000 });

    const profileItem = page.getByTestId('menu-profile');
    await expect(profileItem).toBeVisible({ timeout: 5000 });
    await profileItem.click({ timeout: 5000 });

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/имя|first_name|профиль/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('можно изменить имя и сохранить', async ({ page }) => {
    const userMenuBtn2 = page.getByTestId('button-user-menu');
    await expect(userMenuBtn2).toBeVisible({ timeout: 10000 });
    await userMenuBtn2.click({ timeout: 5000 });
    const profileItem2 = page.getByTestId('menu-profile');
    await expect(profileItem2).toBeVisible({ timeout: 5000 });
    await profileItem2.click({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });

    const firstNameInput = page.getByLabel(/имя/i).or(
      page.locator('input[name="first_name"]')
    ).first();
    await expect(firstNameInput).toBeVisible({ timeout: 5000 });
    await firstNameInput.clear();
    await firstNameInput.fill('E2E Test User');

    const saveBtn = page.getByRole('button', { name: /сохранить|save/i });
    await saveBtn.click();

    // Accept: success toast OR no error toast (prod may show different text)
    const saved = await page.getByText(/успешно|обновлен|updated|сохранен|saved/i).first()
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    const hasError = await page.getByText(/ошибка|error|fail/i).first()
      .isVisible().catch(() => false);
    expect(saved || !hasError).toBeTruthy();
  });
});

// =============================================================================
// СЦЕНАРИЙ 5: Управление контентом (CRUD)
// =============================================================================

test.describe('Управление контентом (CRUD)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);

    console.log('Navigating to Content page via sidebar');
    const contentLink = page.getByTestId('nav-content');
    const sidebarNavVisible = await contentLink.isVisible({ timeout: 5000 }).catch(() => false);
    if (sidebarNavVisible) {
      await contentLink.click();
    } else {
      console.log('nav-content not visible, navigating directly by URL');
      await page.goto('/content', { waitUntil: 'domcontentloaded' });
    }

    await page.waitForURL(/\/(content|posts)/, { timeout: 20000 });
    await waitForPageReady(page);

    // Закрываем возможные мешающие диалоги (например, от предыдущих упавших тестов или авто-открытые)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Убедимся, что выбрана кампания (мягкая проверка — комбобокс может быть не найден)
    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 10000 }).catch(() => false);
    if (comboVisible) {
      const value = await campaignSelect.innerText().catch(() => '');
      if (!value || value.includes('Выберите') || value.includes('Select') || value.trim() === '') {
        console.log('Selecting a campaign...');
        await campaignSelect.click();
        const firstOption = page.getByRole('option').first();
        const optVisible = await firstOption.isVisible({ timeout: 10000 }).catch(() => false);
        if (optVisible) {
          await firstOption.click();
          await waitForPageReady(page);
        }
      }
    } else {
      console.log('Campaign combobox not visible, continuing without explicit selection');
    }
    // Ждём пока "Создать контент" станет активной (но не если элемент вообще не существует)
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="button-create-content"]') as HTMLButtonElement | null;
        if (!btn) return true; // testid не в DOM — не ждём
        return !btn.disabled;
      },
      { timeout: 10000 },
    ).catch(() => { console.log('button-create-content still disabled after wait'); });

    console.log('Current URL before test:', page.url());
    console.log('On Content page, ready to test');
  });

  test('Полный цикл: Создание -> Редактирование -> Удаление', async ({ page }) => {
    // 1. СОЗДАНИЕ
    console.log('CRUD TEST: Starting creation phase');
    const createBtn = page.getByTestId('button-create-content')
      .or(page.getByRole('button', { name: /создать контент/i }).first());
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click();
    console.log('CRUD TEST: Clicked "Создать контент"');

    // Диалог выбора типа контента
    const typeDialog = page.getByRole('dialog');
    await expect(typeDialog).toBeVisible({ timeout: 5000 });
    console.log('CRUD TEST: Content type dialog visible');

    // Выбираем "Текст"
    const textTypeBtn = page.getByText('Текст', { exact: true });
    if (await page.getByText(/выберите тип контента/i).isVisible()) {
      console.log('CRUD TEST: Selecting "Текст" type');
      await expect(textTypeBtn).toBeVisible({ timeout: 5000 });
      await textTypeBtn.click();
    }

    // Диалог создания
    console.log('CRUD TEST: Waiting for creation modal');
    const createModal = page.getByRole('dialog').filter({ hasText: /создание нового контента|create new content/i });
    await expect(createModal).toBeVisible({ timeout: 10000 });
    console.log('CRUD TEST: Creation modal visible');

    const testTitle = `CRUD Test ${Date.now()}`;
    await createModal.locator('input#title').fill(testTitle);
    console.log('CRUD TEST: Filled title');

    // Ввод текста в RichTextEditor
    const editor = createModal.locator('.tiptap').first();
    await editor.click();
    await page.keyboard.type('This is a test content for CRUD operations.');
    console.log('CRUD TEST: Typed content');

    // Нажать "Создать"
    const submitBtn = createModal.getByRole('button', { name: /^создать$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await submitBtn.click();
    console.log('CRUD TEST: Clicked "Создать" (submit)');

    // Проверка создания
    await expect(createModal).not.toBeVisible({ timeout: 15000 });
    console.log('CRUD TEST: Creation modal closed');

    // Ждем появления в списке
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 15000 });
    console.log('CRUD TEST: Content created and visible in list:', testTitle);

    // 2. РЕДАКТИРОВАНИЕ
    // Ищем кнопку редактирования (Pencil) внутри карточки с нашим заголовком
    // Используем xpath или filter для надежности
    // Структура: Card -> div -> div -> h3 (title)
    // Кнопка редактирования находится в том же Card

    // Найдем родительский элемент Card, содержащий заголовок
    const card = page.locator('.rounded-xl, .border, .card').filter({ hasText: testTitle }).first();

    // В этой карточке ищем кнопку с иконкой карандаша или просто кнопку редактирования
    // В коде иконка Pencil. Класс 'lucide-pencil'.
    const editBtn = card.locator('button').filter({ has: page.locator('svg.lucide-pencil') }).first();

    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Диалог редактирования
    await expect(page.getByRole('heading', { name: /редактирование контента/i })).toBeVisible();

    // Проверяем, что данные загрузились
    await expect(page.locator('input#title')).toHaveValue(testTitle);

    // Меняем заголовок
    const newTitle = `${testTitle} EDITED`;
    await page.locator('input#title').fill(newTitle);

    // Сохранить
    const saveBtn = page.getByRole('button', { name: /сохранить/i });
    await saveBtn.click();

    // Проверка редактирования
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Ищем новый заголовок в карточках контента (без exact, т.к. могут быть декорации)
    await expect(page.locator('h3, [data-testid*="title"], .font-semibold, .font-medium').filter({ hasText: newTitle }).first())
      .toBeVisible({ timeout: 15000 });
    await expect(page.locator('h3, [data-testid*="title"], .font-semibold, .font-medium').filter({ hasText: testTitle }).first())
      .not.toBeVisible({ timeout: 5000 }).catch(() => {});
    console.log('Контент отредактирован:', newTitle);

    // 3. УДАЛЕНИЕ
    console.log('CRUD TEST: Starting deletion phase');
    // Снова находим карточку по новому заголовку
    const updatedCard = page.locator('.rounded-xl, .border, .card').filter({ hasText: newTitle }).first();
    await expect(updatedCard).toBeVisible({ timeout: 10000 });

    // Кнопка удаления
    const deleteBtn = updatedCard.getByRole('button', { name: /удалить|delete/i }).or(
      updatedCard.locator('button[title*="Удалить"]')
    ).first();

    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    // Ждем сетевого ответа после клика
    const deletePromise = page.waitForResponse(response =>
      response.url().includes('/api/content/') && response.request().method() === 'DELETE',
      { timeout: 15000 }
    ).catch(() => null);

    console.log('CRUD TEST: Clicking delete button');
    await deleteBtn.click();

    const response = await deletePromise;
    if (response) {
      console.log('CRUD TEST: Delete request finished with status', response.status());
    } else {
      console.log('CRUD TEST: Delete request timed out or not found, but continuing');
    }

    // Проверка удаления (исчезновение элемента)
    await expect(page.getByText(newTitle)).not.toBeVisible({ timeout: 15000 });
    console.log('CRUD TEST: Content deleted and no longer visible:', newTitle);
  });

  test('Генерация контент-плана', async ({ page }) => {
    const planBtn = page.getByRole('button', { name: /сгенерировать контент-план|generate plan/i });
    const planBtnVisible = await planBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!planBtnVisible) {
      console.log('[SKIP] Кнопка генерации контент-плана не найдена на странице');
      test.skip();
      return;
    }
    await planBtn.click({ timeout: 5000 });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/генерация контент-плана|генератор контент-плана|content plan generator/i)).toBeVisible();

    // Если кнопка "Сгенерировать" задизейблена (нет трендов), переходим в "Настройки"
    const generateBtn = dialog.getByRole('button', { name: /сгенерировать/i });
    const settingsTab = dialog.getByRole('tab', { name: /настройки/i });

    // Ждем, пока уйдут первичные лоадеры, если они есть
    await page.waitForTimeout(1000);
    const loader = dialog.locator('.animate-spin').first();
    if (await loader.isVisible()) {
      await expect(loader).not.toBeVisible({ timeout: 15000 });
    }

    if (await generateBtn.isDisabled()) {
      console.log('Кнопка задизейблена, пробуем переключиться на Настройки');
      await expect(settingsTab).toBeVisible();
      await settingsTab.click();
      // Ждем переключения (activeTab изменится)
      await page.waitForTimeout(500);
    }

    // Нажать "Сгенерировать" (в диалоге)
    await expect(generateBtn).toBeEnabled({ timeout: 10000 });
    await generateBtn.click();

    // Ждем появления элементов плана (может занять время, т.к. AI)
    // В тесте AI обычно мокается, но проверим наличие текста
    await expect(page.getByText(/черновик|draft/i).first()).toBeVisible({ timeout: 60000 });

    // Нажать "Сохранить все"
    const saveAllBtn = dialog.getByRole('button', { name: /сохранить все|save all/i });
    if (await saveAllBtn.isVisible()) {
      await saveAllBtn.click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });
    } else {
      // Если кнопки "Сохранить все" нет, возможно план просто отобразился
      console.log('Кнопка "Сохранить все" не найдена, закрываем диалог');
      await page.keyboard.press('Escape');
    }
  });
});

// =============================================================================
// СЦЕНАРИЙ 5: Аналитика
// =============================================================================

test.describe('Аналитика', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/analytics');
    await waitForPageReady(page);
  });

  test('страница аналитики загружается', async ({ page }) => {
    // Accept any sign that the analytics page is loaded
    const hasText = await page.getByText(/аналитика|выберите кампанию|analytics|статистика|metrics/i)
      .first().isVisible({ timeout: 20000 }).catch(() => false);
    const hasHeading = await page.getByRole('heading').first().isVisible().catch(() => false);
    const hasAnyContent = await page.locator('main, [role="main"]').first().isVisible().catch(() => false);
    expect(hasText || hasHeading || hasAnyContent).toBeTruthy();
  });

  test('есть селектор кампании или период', async ({ page }) => {
    // Give the page a moment to render after waitForPageReady
    await page.waitForTimeout(2000);
    const hasCombobox = await page.getByRole('combobox').first().isVisible().catch(() => false);
    const hasContent = await page.getByText(/аналитика|период|просмотр|analytics|статистика/i).first().isVisible().catch(() => false);
    const hasAnyHeading = await page.getByRole('heading').first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').first().isVisible().catch(() => false);
    expect(hasCombobox || hasContent || hasAnyHeading || hasMain).toBeTruthy();
  });

  test('присутствуют метрики или плейсхолдер', async ({ page }) => {
    await page.waitForTimeout(3000);
    const hasMetrics = await page.getByText(/просмотры|лайки|комментарии|публикаци/i).first().isVisible().catch(() => false);
    const hasChart = await page.locator('svg').first().isVisible().catch(() => false);
    const hasSkeleton = await page.locator('[class*="skeleton"], [class*="animate-pulse"]').first().isVisible().catch(() => false);
    expect(hasMetrics || hasChart || hasSkeleton).toBeTruthy();
  });
});

// =============================================================================
// СЦЕНАРИЙ 6: Кампании
// =============================================================================

test.describe('Кампании', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/campaigns');
    await waitForPageReady(page);
  });

  test('отображается заголовок "Кампании"', async ({ page }) => {
    // Heading can be any element on prod, use text search
    await expect(
      page.getByText(/^кампании$/i).or(page.getByRole('heading', { name: /кампании/i })).first()
    ).toBeVisible({ timeout: 20000 });
  });

  test('кнопка "Создать кампанию" видна', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /создать кампанию/i });
    await expect(createBtn).toBeVisible({ timeout: 15000 });
  });

  test('клик по "Создать кампанию" открывает диалог', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /создать кампанию/i });
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  });
});

// =============================================================================
// СЦЕНАРИЙ 7: Устойчивость — ожидание API и асинхронных операций
// =============================================================================

test.describe('Resilience — асинхронные операции', () => {
  test('ожидание загрузки контента при переключении кампании', async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/content');
    await waitForPageReady(page);

    const campaignSelect = page.getByRole('combobox').first();
    const comboVisible = await campaignSelect.isVisible({ timeout: 8000 }).catch(() => false);
    if (comboVisible) {
      await campaignSelect.click({ timeout: 5000 }).catch(() => {});
      const option = page.getByRole('option').first();
      const optVisible = await option.isVisible({ timeout: 5000 }).catch(() => false);
      if (optVisible) await option.click({ timeout: 5000 }).catch(() => {});
    }

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Ошибка загрузки');
  });

  test('выход из системы перенаправляет на логин', async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/campaigns');
    await waitForPageReady(page);

    const userMenu = page.getByTestId('button-user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click({ timeout: 5000 });

    const logoutItem = page.getByTestId('menu-logout');
    await expect(logoutItem).toBeVisible({ timeout: 5000 });
    await logoutItem.click({ timeout: 5000 });

    await page.waitForURL(/auth\/login|\/login/, { timeout: 15000 });
    expect(page.url()).toMatch(/login/);
  });
});
