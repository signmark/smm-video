/**
 * Токены соцсетей не ездят в query-строке.
 *
 * Находка ревью 2026-07-29. Три ручки принимали чужой access_token параметром URL:
 *
 *   GET /api/vk/groups?access_token=…
 *   GET /api/vk/validate?access_token=…
 *   GET /api/youtube/channel-info?accessToken=…
 *
 * Query-строка — самое протекающее место запроса. Она попадает в access-логи
 * (nginx/traefik пишут её по умолчанию), в историю браузера, в Referer при
 * переходе с этой страницы, в закладки и в тексты ошибок axios/node-fetch,
 * которые кладут полный URL в message. Токен VK живёт годами, токен YouTube —
 * час, но и его хватает.
 *
 * Тело POST ничего из этого не задевает. Заголовок Authorization здесь занят
 * СЕССИЕЙ пользователя, поэтому социальный токен уезжает именно телом.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';

const H = vi.hoisted(() => ({
  axiosGet: vi.fn(async () => ({ data: { response: { items: [], count: 0 } } })),
  fetchMock: vi.fn(),
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: H.axiosGet, post: vi.fn(), interceptors };
  return {
    default: { get: H.axiosGet, post: vi.fn(), create: () => instance, interceptors },
    create: () => instance,
  };
});

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

vi.mock('../services/global-api-keys.js', () => ({
  GlobalApiKeysService: class { getGlobalApiKey = vi.fn(async () => 'key'); },
}));
vi.mock('../services/global-api-keys', () => ({
  GlobalApiKeysService: class { getGlobalApiKey = vi.fn(async () => 'key'); },
  globalApiKeysService: { getGlobalApiKey: vi.fn(async () => 'key') },
}));

import vkRouter from '../routes/vk-oauth';
import youtubeChannelRouter from '../routes/youtube-channel';
// redactText берём НАСТОЯЩИЙ: мок логгера выше подменяет модуль целиком, и
// проверять редакцию на заглушке смысла нет.
const { redactText } = await vi.importActual<typeof import('../utils/logger')>('../utils/logger');

const app = express();
app.use(express.json());
app.use('/api', vkRouter);
app.use('/api', youtubeChannelRouter);

const VK_TOKEN = 'vk1.a.SUPER_SECRET_VK_TOKEN_VALUE';
const YT_TOKEN = 'ya29.SUPER_SECRET_YOUTUBE_TOKEN_VALUE';

beforeEach(() => {
  vi.clearAllMocks();
  H.axiosGet.mockResolvedValue({ data: { response: { items: [], count: 0 } } } as any);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ items: [{ id: 'ch', snippet: { title: 'c' }, statistics: {} }] }),
    text: async () => '',
  }));
});

describe('POST /api/vk/groups — токен в теле', () => {
  it('принимает accessToken телом и ходит в VK', async () => {
    const res = await request(app).post('/api/vk/groups').send({ accessToken: VK_TOKEN });

    expect(res.status).toBe(200);
    expect(H.axiosGet).toHaveBeenCalled();
  });

  it('без токена — 400, во внешний API не ходим', async () => {
    const res = await request(app).post('/api/vk/groups').send({});

    expect(res.status).toBe(400);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('GET с токеном в query больше не обслуживается', async () => {
    const res = await request(app).get('/api/vk/groups').query({ access_token: VK_TOKEN });

    // Ручки с таким контрактом нет — 404 от Express. Главное: она не работает.
    expect(res.status).toBe(404);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });
});

describe('POST /api/vk/validate — токен в теле', () => {
  it('принимает accessToken телом', async () => {
    H.axiosGet.mockResolvedValue({ data: { response: [{ id: 1, first_name: 'И', last_name: 'И' }] } } as any);

    const res = await request(app).post('/api/vk/validate').send({ accessToken: VK_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('GET с токеном в query больше не обслуживается', async () => {
    const res = await request(app).get('/api/vk/validate').query({ access_token: VK_TOKEN });

    expect(res.status).toBe(404);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });
});

describe('POST /api/youtube/channel-info — токен в теле', () => {
  it('принимает accessToken телом', async () => {
    const res = await request(app).post('/api/youtube/channel-info').send({ accessToken: YT_TOKEN });

    expect(res.status).toBe(200);
  });

  it('без токена — 400', async () => {
    const res = await request(app).post('/api/youtube/channel-info').send({});
    expect(res.status).toBe(400);
  });

  it('GET с токеном в query больше не обслуживается', async () => {
    const res = await request(app).get('/api/youtube/channel-info').query({ accessToken: YT_TOKEN });
    expect(res.status).toBe(404);
  });
});

/**
 * Даже если токен всё-таки окажется в тексте (ошибка axios с полным URL) —
 * в лог он не попадёт.
 */
describe('редакция логов', () => {
  it('access_token в query-строке вырезается', () => {
    const line = `Request failed: GET https://api.vk.com/method/groups.get?access_token=${VK_TOKEN}&v=5.131`;

    const redacted = redactText(line);

    expect(redacted).not.toContain(VK_TOKEN);
    // Имя параметра остаётся: лог, где всё «[REDACTED]», бесполезен так же,
    // как лог с секретами опасен.
    expect(redacted).toContain('access_token=');
  });

  it('accessToken в JSON-теле вырезается', () => {
    const line = JSON.stringify({ accessToken: YT_TOKEN, channel: 'x' });

    const redacted = redactText(line);

    expect(redacted).not.toContain(YT_TOKEN);
  });

  it('Bearer-заголовок вырезается, схема остаётся', () => {
    const redacted = redactText(`Authorization: Bearer ${VK_TOKEN}`);

    expect(redacted).not.toContain(VK_TOKEN);
    expect(redacted).toContain('Bearer');
  });
});

/**
 * Статическая проверка клиента: токен не должен снова уехать в URL.
 */
describe('клиент не кладёт токены соцсетей в query', () => {
  const clientDir = path.resolve(__dirname, '../../client/src');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('ни один вызов НАШЕГО API не несёт токен в query-строке', () => {
    // Ограничиваемся своими путями (/api/...): внешние Graph API — отдельная
    // история, их контракт мы не выбираем.
    const badCall = /['"`]\/api\/[^'"`]*[?&](access_?token|accessToken)=/i;

    const offenders = walk(clientDir)
      .filter((file) => badCall.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(clientDir, file));

    expect(offenders).toEqual([]);
  });
});
