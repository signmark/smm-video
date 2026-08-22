/**
 * AI-101 Phase 2B, канарейки: каждый переведённый вызов проверяется исполнением.
 *
 * Сторож покрытия (`telegram-transport-coverage.test.ts`) читает ТЕКСТ файлов —
 * он поймает двадцать первый вызов, дописанный завтра, но не скажет, что
 * сегодняшний запрос действительно ушёл в транспорт с прежним URL и прежними
 * настройками. Здесь проверяется ровно это: код исполняется, а двойник
 * транспорта показывает, что именно он получил.
 *
 * Один принцип на весь файл: помимо утверждения «ушло транспортом» рядом
 * стоит свидетель «мимо не ушло ничего» — голый axios и глобальный fetch на
 * api.telegram.org должны быть нулём. Без свидетеля тест проходит и тогда,
 * когда запрос уехал двумя дорогами сразу.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

const tgPost = vi.hoisted(() => vi.fn());
const tgGet = vi.hoisted(() => vi.fn());

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: async () => ({ post: tgPost, get: tgGet }),
}));

// Активация тарифа в боте — не предмет этих проверок; нам нужен только путь,
// который ведёт к уведомлению пользователя.
vi.mock('../services/apply-subscription', () => ({
  applySubscription: async () => ({ ok: true, readback: { plan: 'basic', expire_date: '2026-09-11' } }),
}));

// Своего мока axios здесь нет намеренно: глобальный из `setup.ts` умеет
// `create()` и интерцепторы, а автомок ломает импорт `server/directus.ts`.
const mockedAxios = vi.mocked(axios, true);

/** Запросы, ушедшие мимо транспорта через глобальный fetch. Обязаны быть нулём. */
const fetchToTelegram: string[] = [];

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) fetchToTelegram.push(u);
    return handler(u, init);
  }));
}

function jsonOk(data: any) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchToTelegram.length = 0;
  process.env.TELEGRAM_BOT_TOKEN = 'BOTTOKEN';
  process.env.DIRECTUS_URL = 'https://directus.local';
  process.env.DIRECTUS_STATIC_TOKEN = 'admin';
  // AI-89: getPublicOrigin() теперь бросает в проде без APP_PUBLIC_URL
  // (раньше был silent fallback на smm.omemo.tech).
  process.env.APP_PUBLIC_URL = 'http://app.test';
});

describe('Phase 2B, бот: одобрение подписки уведомляет пользователя транспортом', () => {
  /**
   * Обработчик достаём без запуска бота: `Object.create` + `setupHandlers()`.
   * Полноценный конструктор поднимает синхронизацию сессий и чтение базы —
   * к проверяемому свойству это отношения не имеет, а флейки добавляет.
   */
  async function registerHandlers() {
    const { TelegramBotService } = await import('../telegram-bot/index');
    const actions: Array<{ pattern: any; handler: any }> = [];
    const ons: Array<{ filter: any; handler: any }> = [];
    const svc: any = Object.create(TelegramBotService.prototype);
    svc.bot = {
      on: (filter: any, handler: any) => ons.push({ filter, handler }),
      action: (pattern: any, handler: any) => actions.push({ pattern, handler }),
    };
    svc.setupHandlers();
    return { actions, ons };
  }

  function approveCtx(userId: string) {
    const shown: string[] = [];
    const ctx: any = {
      match: [`sap:${userId}:30:b`, userId, '30', 'b'],
      session: {},
      answerCbQuery: vi.fn(async () => {}),
      editMessageText: vi.fn(async (t: string) => { shown.push(t); }),
      reply: vi.fn(async (t: string) => { shown.push(t); }),
    };
    return { ctx, shown };
  }

  it('sendMessage уходит транспортом: тот же маршрут, то же тело, fetch на Telegram — ноль', async () => {
    const { actions } = await registerHandlers();
    const approve = actions.find(a => a.pattern instanceof RegExp && a.pattern.source.includes('sap'));
    expect(approve, 'обработчик sap: должен быть зарегистрирован').toBeTruthy();

    stubFetch(() => jsonOk({ data: { telegram_chat_id: 555 } }));
    tgPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const { ctx } = approveCtx('bot-user-1');
    await approve!.handler(ctx);

    expect(tgPost).toHaveBeenCalledTimes(1);
    expect(tgPost.mock.calls[0][0]).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');

    const body = tgPost.mock.calls[0][1];
    expect(body.chat_id).toBe(555);
    expect(body.text).toContain('Подписка активирована');
    // parse_mode здесь не было и до перевода: текст с ником пользователя
    // ломал HTML-разбор. Ключи перечислены целиком — добавится третий,
    // и тест это скажет.
    expect(Object.keys(body).sort()).toEqual(['chat_id', 'text']);

    const cfg = tgPost.mock.calls[0][2];
    expect(cfg.headers).toEqual({ 'Content-Type': 'application/json' });
    // fetch не бросал на 4xx/5xx — validateStatus сохраняет это поведение.
    expect(cfg.validateStatus(500)).toBe(true);

    expect(fetchToTelegram).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('отказ транспорта не роняет одобрение: пользователь без связи, тариф выдан', async () => {
    const { actions } = await registerHandlers();
    const approve = actions.find(a => a.pattern instanceof RegExp && a.pattern.source.includes('sap'));

    stubFetch(() => jsonOk({ data: { telegram_chat_id: 556 } }));
    tgPost.mockRejectedValueOnce(new Error('все адреса недоступны'));

    const { ctx, shown } = approveCtx('bot-user-2');
    await expect(approve!.handler(ctx)).resolves.not.toThrow();
    expect(shown.some(t => t.includes('Подписка активирована'))).toBe(true);
  });

  it('файл фото скачивается транспортом по /file/bot, голый axios не зовётся', async () => {
    const { ons } = await registerHandlers();
    // text, photo, voice — в порядке регистрации в setupHandlers().
    expect(ons).toHaveLength(3);
    const photoHandler = ons[1].handler;

    // Обрываем сразу после запроса: дальше идут временный файл и выгрузка в
    // S3 — к проверяемому свойству они отношения не имеют.
    tgGet.mockRejectedValueOnce(new Error('стоп после запроса'));

    const ctx: any = {
      message: { photo: [{ file_id: 'small' }, { file_id: 'big' }] },
      session: { token: 'user-token' },
      reply: vi.fn(async () => {}),
      telegram: { getFile: vi.fn(async () => ({ file_path: 'photos/file_1.jpg' })) },
    };
    await photoHandler(ctx);

    expect(tgGet).toHaveBeenCalledTimes(1);
    expect(tgGet.mock.calls[0][0]).toBe('https://api.telegram.org/file/botBOTTOKEN/photos/file_1.jpg');
    // Ровно прежние настройки: бинарный ответ и никакого таймаута —
    // его в этом вызове не было и до перевода.
    expect(tgGet.mock.calls[0][1]).toEqual({ responseType: 'arraybuffer' });
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(fetchToTelegram).toEqual([]);
  });
});

describe('Phase 2B, заявки на подписку', () => {
  it('заявка админу уходит транспортом с кнопкой одобрения', async () => {
    process.env.TELEGRAM_ADMIN_CHAT_ID = '999';
    // «Корпоративный» берёт цену из окружения — поход в Directus за прайсом
    // здесь ни при чём.
    process.env.PLAN_PRICE_ENTERPRISE_LABEL = 'По договорённости';
    tgPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const { sendSubscriptionNotification } = await import('../routes/subscriptions');
    await sendSubscriptionNotification('req-user-1', 'Пользователь', 'u@example.com', 'Корпоративный');

    expect(tgPost).toHaveBeenCalledTimes(1);
    expect(tgPost.mock.calls[0][0]).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');
    const body = tgPost.mock.calls[0][1];
    expect(body.chat_id).toBe('999');
    expect(body.parse_mode).toBe('HTML');
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toMatch(/^sap:req-user-1:\d+:c$/);
    // Второго аргумента у этого вызова не было — перевод его не добавил.
    expect(tgPost.mock.calls[0]).toHaveLength(2);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(fetchToTelegram).toEqual([]);
  });

  it('одобрение по ссылке уведомляет пользователя транспортом', async () => {
    process.env.APP_SIGNING_SECRET = 'test-secret';
    const userId = 'link-user-1';
    const plan = 'Базовый';
    const days = 30;
    const token = crypto
      .createHmac('sha256', 'test-secret')
      .update(`${userId}:${plan}:${days}`)
      .digest('hex')
      .slice(0, 32);

    stubFetch((u, init) => {
      if (init?.method === 'PATCH') return jsonOk({ data: { id: userId } });
      return jsonOk({ data: { telegram_chat_id: 777 } });
    });
    tgPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const router = (await import('../routes/subscriptions')).default;
    const app = express();
    app.use('/api', router);

    const res = await request(app)
      .get('/api/subscriptions/approve')
      .query({ userId, plan, days: String(days), token });

    expect(res.status).toBe(200);
    expect(tgPost).toHaveBeenCalledTimes(1);
    expect(tgPost.mock.calls[0][0]).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');
    const body = tgPost.mock.calls[0][1];
    expect(body.chat_id).toBe(777);
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('Подписка активирована');
    expect(tgPost.mock.calls[0][2].validateStatus(500)).toBe(true);
    // Запись в Directus идёт своим fetch — на Telegram не ушло ни одного.
    expect(fetchToTelegram).toEqual([]);
  });
});

describe('Phase 2B, VK: уведомление об истёкшем токене', () => {
  it('шлёт транспортом в каждую сессию пользователя', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { data: { user_id: 'vk-user-1', title: 'Кампания', social_media_settings: {} } },
      } as any)
      .mockResolvedValueOnce({ data: { data: [{ chat_id: 11 }, { chat_id: 22 }] } } as any);
    mockedAxios.patch.mockResolvedValueOnce({ data: {} } as any);
    tgPost.mockResolvedValue({ status: 200, data: { ok: true } });

    const { markVkAuthExpired } = await import('../services/vk-token-refresh');
    await markVkAuthExpired('camp-1');

    // Уведомление отправляется вдогонку, не блокируя основной поток.
    await vi.waitFor(() => expect(tgPost).toHaveBeenCalledTimes(2));
    expect(tgPost.mock.calls[0][0]).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');
    expect(tgPost.mock.calls[0][1].chat_id).toBe(11);
    expect(tgPost.mock.calls[1][1].chat_id).toBe(22);
    expect(tgPost.mock.calls[0][1].parse_mode).toBe('HTML');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
