/**
 * SM-24 (продолжение): живая проверка связи с Telegram.
 *
 * ЧТО БЫЛО. Метка «Настроено» отвечала на вопрос «сохранены ли поля», а не
 * «дойдёт ли публикация». Отозванный токен, выгнанный из канала бот и бот без
 * права публикации выглядели одинаково зелёными; правду человек узнавал из
 * несостоявшейся публикации. Тестировщик ждал именно проверку связи.
 *
 * Проверка обязана быть только читающей: getMe, getChat, getChatMember.
 * Отправка сообщения в живой канал ради проверки недопустима.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  get: vi.fn(async (_url: string, _cfg?: any) => ({ data: { ok: true, result: {} } })),
  campaignSettings: vi.fn(async (_id: string, _opts?: any) => ({} as any)),
}));

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: async () => ({ get: H.get, post: vi.fn() }),
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', is_smm_admin: false };
    next();
  },
}));

vi.mock('../services/campaign-token-resolver', async () => {
  const actual = await vi.importActual<any>('../services/campaign-token-resolver');
  return { ...actual, getCampaignSocialSettings: H.campaignSettings };
});

import { validateTelegramConnection } from '../services/social-api-validator';
import { pickPlatformToken } from '../services/campaign-token-resolver';
import { registerValidationRoutes } from '../api/validation-routes';

const BOT = { ok: true, result: { id: 42, username: 'smm_bot', first_name: 'SMM' } };

function axiosError(status: number | undefined, description?: string) {
  const err: any = new Error(description || 'telegram error');
  err.isAxiosError = true;
  err.response = status === undefined ? undefined : { status, data: { ok: false, description } };
  return err;
}

function route(url: string) {
  if (url.endsWith('/getMe')) return 'getMe';
  if (url.endsWith('/getChat')) return 'getChat';
  if (url.endsWith('/getChatMember')) return 'getChatMember';
  return 'other';
}

/** Отвечает по методу Telegram; значение — либо тело ответа, либо ошибка. */
function wire(map: Record<string, any>) {
  H.get.mockImplementation(async (url: string) => {
    const value = map[route(url)];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`неожиданный вызов ${url}`);
    return { data: value };
  });
}

beforeEach(() => {
  H.get.mockReset();
  H.campaignSettings.mockReset();
});

describe('SM-24: проверка связи с Telegram', () => {
  it('живой бот с правом публикации — связь есть', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { id: -100, title: 'Мой канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: true } },
    });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(true);
    expect(res.message).toContain('Мой канал');
    expect(res.details?.canPost).toBe(true);
  });

  it('ничего не отправляет в канал — только чтение', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Мой канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: true } },
    });

    await validateTelegramConnection('TOKEN', '@my_channel');

    const called = H.get.mock.calls.map(c => route(c[0] as string));
    expect(called.sort()).toEqual(['getChat', 'getChatMember', 'getMe']);
    expect(called.some(m => m === 'other')).toBe(false);
  });

  it('отозванный токен — отказ по настройке, повтор не поможет', async () => {
    wire({ getMe: axiosError(401, 'Unauthorized') });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(false);
    expect(res.severity).toBe('error');
    expect(res.retryable).toBe(false);
    expect(res.message).toContain('Замените токен');
  });

  it('Telegram не отвечает — это «подождите», а не «настройте заново»', async () => {
    wire({ getMe: axiosError(undefined) });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(false);
    expect(res.severity).toBe('warning');
    expect(res.retryable).toBe(true);
  });

  it('канал не найден — говорим про идентификатор канала, а не про токен', async () => {
    wire({ getMe: BOT, getChat: axiosError(400, 'chat not found') });

    const res = await validateTelegramConnection('TOKEN', '@wrong');

    expect(res.isValid).toBe(false);
    expect(res.severity).toBe('error');
    expect(res.message).toContain('не видит канал');
  });

  it('бота выгнали из канала — связь потеряна', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Мой канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'kicked' } },
    });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(false);
    expect(res.message).toContain('удалён из канала');
  });

  it('бот в канале, но не администратор — публиковать не сможет', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Мой канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'member' } },
    });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(false);
    expect(res.message).toContain('администратор');
  });

  it('администратор без права публикации — тоже не связь', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Мой канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: false } },
    });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(false);
    expect(res.message).toContain('без права публикации');
  });

  it('канал не указан — сказано прямо, что публиковать некуда', async () => {
    wire({ getMe: BOT });

    const res = await validateTelegramConnection('TOKEN', '   ');

    expect(res.isValid).toBe(false);
    expect(res.message).toContain('канал не указан');
  });

  it('право публикации проверить не вышло — связь подтверждена, но с оговоркой', async () => {
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Мой канал', type: 'channel' } },
      getChatMember: axiosError(500, 'Internal'),
    });

    const res = await validateTelegramConnection('TOKEN', '@my_channel');

    expect(res.isValid).toBe(true);
    expect(res.severity).toBe('warning');
  });
});

describe('SM-24: маршрут /api/validate/telegram', () => {
  function app() {
    const server = express();
    server.use(express.json());
    registerValidationRoutes(server);
    return server;
  }

  it('проверяет СОХРАНЁННОЕ подключение: токена в браузере нет', async () => {
    H.campaignSettings.mockResolvedValue({ telegram: { token: 'SAVED', chatId: '@saved_channel' } });
    wire({
      getMe: BOT,
      getChat: { ok: true, result: { title: 'Сохранённый канал', type: 'channel' } },
      getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: true } },
    });

    const res = await request(app())
      .post('/api/validate/telegram')
      .send({ campaignId: 'camp-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const getChatCall = H.get.mock.calls.find(c => route(c[0] as string) === 'getChat');
    expect((getChatCall?.[1] as any)?.params?.chat_id).toBe('@saved_channel');
  });

  it('вердикт уходит человеку, а токен — никогда', async () => {
    H.campaignSettings.mockResolvedValue({ telegram: { token: 'SAVED-SECRET', chatId: '@c' } });
    wire({ getMe: axiosError(401, 'Unauthorized') });

    const res = await request(app())
      .post('/api/validate/telegram')
      .send({ campaignId: 'camp-1' });

    expect(res.body.success).toBe(false);
    expect(res.body.severity).toBe('error');
    expect(JSON.stringify(res.body)).not.toContain('SAVED-SECRET');
  });

  it('без сохранённого токена и без введённого — понятный отказ', async () => {
    H.campaignSettings.mockResolvedValue({ telegram: { chatId: '@c' } });

    const res = await request(app())
      .post('/api/validate/telegram')
      .send({ campaignId: 'camp-1' });

    expect(res.status).toBe(400);
    expect(H.get).not.toHaveBeenCalled();
  });

  it('старый вызов с одним токеном и без канала работает как прежде', async () => {
    wire({ getMe: BOT });

    const res = await request(app())
      .post('/api/validate/telegram')
      .send({ token: 'TOKEN' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(H.get.mock.calls.map(c => route(c[0] as string))).toEqual(['getMe']);
  });

  it('резолвер токенов знает про Telegram', () => {
    expect(pickPlatformToken({ telegram: { token: 'T' } }, 'telegram')).toBe('T');
    expect(pickPlatformToken({}, 'telegram')).toBeUndefined();
  });
});
