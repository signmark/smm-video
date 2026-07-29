/**
 * Загрузка видео идёт по ОДНОМУ контракту.
 *
 * Находка ревью 2026-07-29. Клиент звал два разных адреса вразнобой, и только
 * один из них существовал на сервере:
 *
 *   /api/beget-s3/upload-video   — не смонтирован НИКОГДА (3 вызова → 404)
 *   /api/beget-s3-video/upload   — настоящая ручка (2 вызова)
 *
 * Расходились и поля: сервер отдаёт `videoUrl`, часть клиентов читала `url`,
 * один слал файл в поле `file` вместо `video`. То есть «две расходящиеся
 * реализации» — это на самом деле одна реализация и три вызова в пустоту:
 * загрузка видео из редактора сторис и со страницы видео просто не работала.
 *
 * Канон зафиксирован здесь: путь `/api/beget-s3-video/upload`, поле формы
 * `video`, ответ `videoUrl`. Тест монтирует настоящий роутер, поэтому переезд
 * ручки или переименование поля ответа его уронят.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';

const H = vi.hoisted(() => ({
  uploadLocalVideo: vi.fn(async () => ({
    success: true,
    videoUrl: 'https://s3.test/videos/abc.mp4',
    thumbnailUrl: 'https://s3.test/thumbs/abc.jpg',
    metadata: { duration: 10 },
    key: 'videos/abc.mp4',
  })),
  uploadVideoFromUrl: vi.fn(async () => ({
    success: true,
    videoUrl: 'https://s3.test/videos/from-url.mp4',
    thumbnailUrl: null,
    metadata: {},
    key: 'videos/from-url.mp4',
  })),
}));

vi.mock('../services/beget-s3-video-service', () => ({
  begetS3VideoService: {
    uploadLocalVideo: H.uploadLocalVideo,
    uploadVideoFromUrl: H.uploadVideoFromUrl,
  },
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import begetS3VideoRouter from '../routes/beget-s3-video';

const app = express();
app.use(express.json());
// Монтируем ровно так же, как server/routes-beget-s3.ts.
app.use('/api/beget-s3-video', begetS3VideoRouter);

beforeEach(() => {
  vi.clearAllMocks();
  H.uploadLocalVideo.mockResolvedValue({
    success: true,
    videoUrl: 'https://s3.test/videos/abc.mp4',
    thumbnailUrl: 'https://s3.test/thumbs/abc.jpg',
    metadata: { duration: 10 },
    key: 'videos/abc.mp4',
  } as any);
});

describe('POST /api/beget-s3-video/upload — канонический контракт', () => {
  it('принимает файл в поле video и отвечает videoUrl', async () => {
    const res = await request(app)
      .post('/api/beget-s3-video/upload')
      .attach('video', Buffer.from('fake-mp4-bytes'), 'clip.mp4');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.videoUrl).toBe('https://s3.test/videos/abc.mp4');
    expect(H.uploadLocalVideo).toHaveBeenCalled();
  });

  it('без файла — 400, в S3 не ходим', async () => {
    const res = await request(app).post('/api/beget-s3-video/upload');

    expect(res.status).toBe(400);
    expect(H.uploadLocalVideo).not.toHaveBeenCalled();
  });

  it('файл в поле file (прежний вызов со страницы видео) ручкой не принимается', async () => {
    // Именно поэтому недостаточно было поправить только путь: поле тоже
    // расходилось.
    const res = await request(app)
      .post('/api/beget-s3-video/upload')
      .attach('file', Buffer.from('fake-mp4-bytes'), 'clip.mp4');

    expect(res.status).not.toBe(200);
    expect(H.uploadLocalVideo).not.toHaveBeenCalled();
  });

  it('upload-from-url отвечает тем же полем videoUrl', async () => {
    const res = await request(app)
      .post('/api/beget-s3-video/upload-from-url')
      .send({ videoUrl: 'https://example.test/v.mp4' });

    expect(res.status).toBe(200);
    expect(res.body.videoUrl).toBe('https://s3.test/videos/from-url.mp4');
  });
});

/**
 * Статическая проверка клиента: мёртвый адрес не должен вернуться.
 *
 * Обычный тест роутера этого не поймал бы — вызов в никуда живёт на клиенте, а
 * сервер о нём ничего не знает. Поэтому проверяем исходники напрямую.
 */
describe('клиент не зовёт несуществующий /api/beget-s3/upload-video', () => {
  const clientDir = path.resolve(__dirname, '../../client/src');

  /** Все .ts/.tsx клиента. */
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('ни один файл клиента не ссылается на мёртвый путь', () => {
    // Ищем именно СТРОКОВЫЙ ЛИТЕРАЛ вызова, а не любое упоминание: путь
    // называется в комментариях, объясняющих, почему его больше нет.
    const deadCall = /['"`]\/api\/beget-s3\/upload-video['"`]/;

    const offenders = walk(clientDir)
      .filter((file) => deadCall.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(clientDir, file));

    expect(offenders).toEqual([]);
  });

  it('каждый вызов загрузки видео читает из ответа videoUrl', () => {
    // `url` — контракт ручки КАРТИНОК (/api/beget-s3/upload), и в некоторых
    // файлах обе загрузки соседствуют. Поэтому проверяем не отсутствие `url`
    // в файле, а наличие `videoUrl` у тех, кто зовёт видео-ручку.
    const callers = walk(clientDir)
      .filter((file) => fs.readFileSync(file, 'utf8').includes('/api/beget-s3-video/upload'));

    expect(callers.length).toBeGreaterThan(0);

    const notReadingVideoUrl = callers
      .filter((file) => !/\bvideoUrl\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(clientDir, file));

    expect(notReadingVideoUrl).toEqual([]);
  });
});
