import { defineConfig, devices } from '@playwright/test';

// Escape hatch на случай своего браузера. Захардкоженный путь к nix-chromium
// отсюда убран: он остался от Replit, на хосте не существует и молча отваливался
// в undefined — то есть не держал ничего, а выглядел как рабочая настройка.
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

/**
 * Адрес стенда обязателен и не имеет умолчания.
 *
 * Молчаливый фолбэк на localhost:5000 — это половина той же ловушки: на
 * прод-хосте по этому адресу окажется либо ничего, либо чужой процесс, и
 * тесты будут «проходить» мимо цели. Лучше отказаться с внятным текстом.
 */
function requireBaseUrl(): string {
  const url = process.env.PLAYWRIGHT_BASE_URL;
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_BASE_URL не задан. Укажите адрес E2E-стенда явно, например ' +
        'PLAYWRIGHT_BASE_URL=http://127.0.0.1:5100. Прод для прогонов не используем: ' +
        'тесты создают кампании и публикации.',
    );
  }
  return url;
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : (process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 3),
  reporter: 'html',
  timeout: process.env.PLAYWRIGHT_TIMEOUT ? parseInt(process.env.PLAYWRIGHT_TIMEOUT) : 30000,
  use: {
    baseURL: requireBaseUrl(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: {
        ...(systemChromium ? { launchOptions: { executablePath: systemChromium } } : {}),
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
        ...(systemChromium ? { launchOptions: { executablePath: systemChromium } } : {}),
      },
      dependencies: ['setup'],
    },
  ],

  // webServer намеренно отсутствует (AI-36).
  //
  // Раньше здесь стояло: нет PLAYWRIGHT_BASE_URL — подними приложение сам
  // через `npm run dev` на порту 5000. На прод-хосте это означало второй
  // экземпляр приложения с боевым /root/.env: второй планировщик публикаций и
  // второй телеграм-бот на той же базе. Наружу это вылезло бы дублями
  // публикаций в живых кампаниях, а не ошибкой запуска — порт 5000 на хосте
  // свободен, и подъём проходил успешно и незаметно.
  //
  // Теперь адрес обязателен и задаётся явно. Приложение под тесты поднимает
  // стенд (отдельный compose-проект со своими Postgres/Directus и пустыми
  // внешними токенами), а не Playwright из каталога с боевым окружением.
});
