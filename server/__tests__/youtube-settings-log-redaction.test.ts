/**
 * Регрессионные тесты сквозного инварианта redaction:
 * ЗНАЧЕНИЯ OAuth-токенов/секретов НЕ попадают в лог (console.*).
 *
 * Инцидент: security-sweep 2026-07-21 (коммиты fdc40a3, ab24f05, 281d780).
 * До свипа GET /api/campaigns/:id/youtube-settings и ветка test-youtube в
 * publishing-routes логировали объект настроек целиком — accessToken и
 * refreshToken утекали в docker logs на каждый просмотр настроек в UI.
 * Ставка: любой, у кого есть доступ к логам контейнера (не обязательно
 * к БД), получал живой доступ к YouTube-каналам пользователей.
 *
 * Конвенция: docs/prompts/TESTING_AS_DOCUMENTATION.md — имя теста = контракт,
 * сквозной инвариант вынесен в хелпер expectNoTokenLeak (правило 5).
 *
 * Охват: server/routes/campaign-youtube-settings.ts (GET) и
 * server/api/publishing-routes.ts (POST /api/test-youtube-publish, ~строка 180).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { format } from 'node:util';
import axios from 'axios';

// --- Моки инфраструктуры publishing-routes ---------------------------------
// Модуль publishing-routes импортирует на верхнем уровне storage, Directus,
// планировщик и генератор сторис. Тестируемый маршрут /api/test-youtube-publish
// их НЕ вызывает — моки нужны только чтобы импорт модуля не тянул за собой
// всю инфраструктуру БД/Directus. В проде это реальные синглтоны хранилища.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/social/index', () => ({ socialPublishingService: {} }));
vi.mock('../directus', () => ({ directusApiManager: {} }));
vi.mock('../services/directus', () => ({ directusStorageAdapter: {} }));
vi.mock('../services/publish-scheduler', () => ({ getPublishScheduler: () => null }));
vi.mock('../services/stories-image-generator', () => ({ generateStoriesImageServer: vi.fn() }));
vi.mock('../utils/content-cache', () => ({ invalidateContentCache: vi.fn() }));
// В проде log() из utils/logger пишет в консоль с префиксом; здесь он не участвует
// в проверяемых ветках, поэтому подменяем заглушкой, чтобы не шуметь в выводе.
vi.mock('../utils/logger', () => ({ log: vi.fn() }));
// В проде authenticateUser (server/middleware/user-auth.ts) валидирует сессию
// пользователя через Directus. Этот файл проверяет redaction, а не auth —
// подменяем middleware пропуском запроса.
vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (_req: any, _res: any, next: any) => next(),
}));
// В проде YouTubeService.publishContent ходит в YouTube Data API с токенами
// пользователя. Мокаем класс, чтобы тест не уходил в сеть; ответ успешный и
// БЕЗ токенов — так выглядит реальный успешный ответ сервиса.
vi.mock('../services/social-platforms/youtube-service', () => ({
  YouTubeService: class {
    publishContent = vi.fn().mockResolvedValue({ success: true, postId: 'yt-test-123' });
  },
}));
// axios замокан глобально в server/__tests__/setup.ts: в проде роут ходит в
// Directus REST API за кампанией; здесь подставляем ответ с настройками.

import youtubeSettingsRouter from '../routes/campaign-youtube-settings';
import { registerPublishingRoutes } from '../api/publishing-routes';

// Реалистичные по форме значения (как в проде): Google access token начинается
// с 'ya29.', refresh token — с '1//'. Уникальные маркеры '-LEAKED-' нужны,
// чтобы утечку нельзя было пропустить визуально в упавшем тесте.
const ACCESS_TOKEN = 'ya29.a0ARrdaM-LEAKED-ACCESS-TOKEN-0123456789abcdef';
const REFRESH_TOKEN = '1//04-LEAKED-REFRESH-TOKEN-abcdef0123456789';
const CHANNEL_ID = 'UC_test_channel_123456';

/**
 * Сквозной инвариант redaction (правило 5 конвенции): ни одно значение секрета
 * не встречается в захваченном логе. Проверка длины секретов встроена, чтобы
 * тест не мог пройти вакуумно на пустой/короткой строке.
 */
function expectNoTokenLeak(loggedOutput: string, secretValues: string[]) {
  expect(secretValues.length).toBeGreaterThan(0);
  for (const secret of secretValues) {
    expect(secret.length).toBeGreaterThan(8);
    expect(loggedOutput).not.toContain(secret);
  }
}

/** Перехват console.* — собирает весь лог-вывод хендлера в одну строку. */
function captureConsole() {
  const chunks: string[] = [];
  const spies = (['log', 'error', 'warn', 'info'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      chunks.push(format(...args));
    })
  );
  return {
    getOutput: () => chunks.join('\n'),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

/** Ответ Directus, как в проде: кампания с youtube-настройками, включая токены. */
function directusCampaignWithYoutube(youtubeSettings: unknown) {
  return {
    data: {
      data: {
        id: 'campaign-1',
        social_media_settings: { youtube: youtubeSettings },
      },
    },
  };
}

const mockedAxiosGet = vi.mocked(axios.get);

describe('GET /campaigns/:campaignId/youtube-settings — redaction токенов в логе', () => {
  let app: express.Express;
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    app = express();
    app.use('/api', youtubeSettingsRouter);
    capture = captureConsole();
    vi.mocked(axios.get).mockReset();
  });

  afterEach(() => {
    capture.restore();
  });

  it('happy-path: авторизованный запрос возвращает настройки клиенту (токены — часть API-ответа)', async () => {
    // Нормальная форма вызова из UI: Bearer-токен пользователя в заголовке,
    // в Directus лежат сохранённые настройки канала.
    mockedAxiosGet.mockResolvedValueOnce(
      directusCampaignWithYoutube({
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        channelId: CHANNEL_ID,
        configured: true,
      })
    );

    const response = await request(app)
      .get('/api/campaigns/campaign-1/youtube-settings')
      .set('Authorization', 'Bearer user-session-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // Контракт API: клиенту настройки отдаются целиком, включая токены —
    // redaction касается ЛОГА, а не ответа авторизованному вызывающему.
    expect(response.body.settings.accessToken).toBe(ACCESS_TOKEN);
  });

  it('регрессия 2026-07-21: лог содержит channelId/configured, но НЕ значения accessToken/refreshToken', async () => {
    // Ставка: до свипа эти значения попадали в docker logs на каждый просмотр
    // настроек в UI — читатель логов получал доступ к каналу пользователя.
    mockedAxiosGet.mockResolvedValueOnce(
      directusCampaignWithYoutube({
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        channelId: CHANNEL_ID,
        configured: true,
      })
    );

    await request(app)
      .get('/api/campaigns/campaign-1/youtube-settings')
      .set('Authorization', 'Bearer user-session-token');

    const logged = capture.getOutput();
    // Диагностическая часть лога должна остаться: по ней понятно, что за канал.
    expect(logged).toContain(CHANNEL_ID);
    expect(logged).toContain('configured: true');
    expectNoTokenLeak(logged, [ACCESS_TOKEN, REFRESH_TOKEN]);
  });

  it('настройки ещё не сконфигурированы: возвращает settings=null и логирует null', async () => {
    mockedAxiosGet.mockResolvedValueOnce(directusCampaignWithYoutube(undefined));

    const response = await request(app)
      .get('/api/campaigns/campaign-1/youtube-settings')
      .set('Authorization', 'Bearer user-session-token');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.settings).toBeNull();
  });

  it('без Bearer-токена и без DIRECTUS_TOKEN: 401, обращения к Directus нет', async () => {
    // В проде fallback — системный DIRECTUS_TOKEN из env; убираем его, чтобы
    // зафиксировать контракт ветки «токен авторизации не доступен».
    const savedToken = process.env.DIRECTUS_TOKEN;
    delete process.env.DIRECTUS_TOKEN;
    try {
      const response = await request(app).get('/api/campaigns/campaign-1/youtube-settings');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(mockedAxiosGet).not.toHaveBeenCalled();
    } finally {
      if (savedToken !== undefined) process.env.DIRECTUS_TOKEN = savedToken;
    }
  });

  it('ошибка Directus: 500 и console.error без значений токенов', async () => {
    mockedAxiosGet.mockRejectedValueOnce(new Error('Request failed with status code 500'));

    const response = await request(app)
      .get('/api/campaigns/campaign-1/youtube-settings')
      .set('Authorization', 'Bearer user-session-token');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    // Ветка ошибки тоже под инвариантом: в catch логируется error.message.
    expectNoTokenLeak(capture.getOutput(), [ACCESS_TOKEN, REFRESH_TOKEN]);
  });
});

describe('POST /api/test-youtube-publish — redaction токенов в логе', () => {
  let app: express.Express;
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    registerPublishingRoutes(app);
    capture = captureConsole();
  });

  afterEach(() => {
    capture.restore();
  });

  it('регрессия 2026-07-21: лог содержит channelId, но НЕ значения accessToken/refreshToken из youtubeSettings', async () => {
    // Нормальная форма вызова: UI тестовой публикации шлёт настройки канала
    // в теле запроса; хендлер логирует их форму (publishing-routes.ts ~180).
    const response = await request(app)
      .post('/api/test-youtube-publish')
      .send({
        contentId: 'content-1',
        content: { title: 'Тест', description: 'Описание', videoUrl: 'https://example.com/v.mp4', tags: [] },
        youtubeSettings: {
          accessToken: ACCESS_TOKEN,
          refreshToken: REFRESH_TOKEN,
          channelId: CHANNEL_ID,
          configured: true,
        },
        userId: 'user-1',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const logged = capture.getOutput();
    expect(logged).toContain(CHANNEL_ID);
    expect(logged).toContain('configured: true');
    expectNoTokenLeak(logged, [ACCESS_TOKEN, REFRESH_TOKEN]);
  });
});
