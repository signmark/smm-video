/**
 * Пути к видеофайлам не собираются из имени, пришедшего от клиента.
 *
 * Находка ревью 2026-07-29, остаток после разбора media-exec. Сами вызовы
 * ffmpeg/ffprobe строкой уже не собираются (media-exec.ts, 2026-07-28), но два
 * маршрута продолжали склеивать ПУТЬ из `req.file.originalname`:
 *
 *   server/routes/video.ts:27           `video_${Date.now()}_${originalname}`
 *   server/routes/videoProcessing.ts:50 `processed_${Date.now()}_${originalname}`
 *
 * `originalname` полностью подконтролен клиенту: multipart не запрещает там ни
 * `../`, ни переводов строки. Итоговый путь уходил в fs.copyFileSync и в
 * fluent-ffmpeg как выходной файл — то есть запись за пределы uploads/processed.
 *
 * Отдельно — раздача: `GET /uploads/processed/:filename` склеивала путь из
 * параметра. Express не даст сегменту содержать `/`, но `%2e%2e%2f` он
 * декодирует ПОСЛЕ сопоставления, и в обработчик приходит уже `../`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import videoRouter from '../routes/video';

const app = express();
app.use('/api/video', videoRouter);

let cwdBefore: string;
let sandbox: string;

beforeEach(() => {
  // Роут пишет в относительный uploads/processed/ — уводим cwd в песочницу,
  // чтобы тест не мусорил в репозитории и мог проверить, что вышло за пределы.
  cwdBefore = process.cwd();
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'video-route-test-'));
  fs.mkdirSync(path.join(sandbox, 'uploads', 'temp'), { recursive: true });
  process.chdir(sandbox);
});

afterEach(() => {
  process.chdir(cwdBefore);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** Всё, что реально создалось внутри uploads/processed. */
function processedFiles(): string[] {
  const dir = path.join(sandbox, 'uploads', 'processed');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/**
 * Отправляет multipart с ПРОИЗВОЛЬНЫМ filename.
 *
 * `.attach()` из superagent прогоняет имя через нормализацию и вырезает `../`
 * ещё на клиенте — то есть traversal до сервера просто не доезжал, и тест
 * зеленел, ничего не проверив. Здесь тело собирается руками, как это сделал бы
 * атакующий curl'ом.
 */
function postVideoWithFilename(filename: string) {
  const boundary = '----test-boundary-0000';
  const body = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="textOverlays"\r\n\r\n[]\r\n`
    + `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n`
    + `Content-Type: video/mp4\r\n\r\nfake-bytes\r\n`
    + `--${boundary}--\r\n`,
    'utf8',
  );

  return request(app)
    .post('/api/video/process')
    .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
    .send(body);
}

describe('POST /api/video/process — имя файла от клиента', () => {
  it('traversal в originalname не пишет за пределы uploads/processed', async () => {
    const res = await postVideoWithFilename('../../../pwned.mp4');

    expect(res.status).toBe(200);

    // Главное: наверху песочницы ничего не появилось.
    expect(fs.existsSync(path.join(sandbox, 'pwned.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, 'uploads', 'pwned.mp4'))).toBe(false);

    // А то, что появилось, лежит внутри и не содержит следов traversal.
    const files = processedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('..');
    expect(files[0]).not.toContain('/');
  });

  it('shell-символы и перевод строки в имени не попадают в путь', async () => {
    const res = await postVideoWithFilename('a$(touch pwned);b c.mp4');

    expect(res.status).toBe(200);

    const files = processedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('обычное имя по-прежнему работает и отдаётся ссылкой', async () => {
    const res = await postVideoWithFilename('clip.mp4');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.videoUrl).toMatch(/^\/uploads\/processed\/[a-zA-Z0-9._-]+$/);
  });
});

describe('GET /api/video/uploads/processed/:filename — раздача', () => {
  /**
   * Каталог раздачи считается от __dirname исходника, а не от cwd, поэтому
   * подкладываем зонды именно туда. `uploads/` в .gitignore, за собой убираем.
   */
  const serveDir = path.resolve(__dirname, '../../uploads/processed');
  const insideFile = path.join(serveDir, 'probe-inside.mp4');
  const outsideFile = path.resolve(serveDir, '..', 'probe-outside.mp4');

  beforeEach(() => {
    fs.mkdirSync(serveDir, { recursive: true });
    fs.writeFileSync(insideFile, 'внутри');
    fs.writeFileSync(outsideFile, 'снаружи');
  });

  afterEach(() => {
    fs.rmSync(insideFile, { force: true });
    fs.rmSync(outsideFile, { force: true });
  });

  it('свой файл из каталога раздачи отдаётся', () => {
    return request(app)
      .get('/api/video/uploads/processed/probe-inside.mp4')
      .expect(200)
      .then((res) => {
        expect(res.text || res.body?.toString?.()).toContain('внутри');
      });
  });

  it('traversal не достаёт файл уровнем выше', async () => {
    // Файл существует и лежит ровно там, куда целится `../`. Если бы имя
    // подставлялось в путь как есть, ответ был бы 200 с его содержимым.
    const res = await request(app).get('/api/video/uploads/processed/%2e%2e%2fprobe-outside.mp4');

    expect(res.status).not.toBe(200);
    expect(String(res.text || '')).not.toContain('снаружи');
  });

  it('абсолютный путь тоже не проходит', async () => {
    const res = await request(app)
      .get(`/api/video/uploads/processed/${encodeURIComponent(outsideFile)}`);

    expect(res.status).not.toBe(200);
    expect(String(res.text || '')).not.toContain('снаружи');
  });

  it('несуществующий файл — 404', async () => {
    const res = await request(app).get('/api/video/uploads/processed/nope.mp4');
    expect(res.status).toBe(404);
  });
});
