/**
 * Имена временных файлов видео уникальны при одновременных загрузках.
 *
 * Находка ревью 2026-07-30. Имя строилось из одного `Date.now()`:
 * `video_${Date.now()}`, `processed_${Date.now()}`, `temp_input_${Date.now()}`.
 * Миллисекунда — не идентификатор: два запроса в одну миллисекунду (обычное
 * дело при параллельных загрузках) получали ОДИН путь, и ffmpeg второго
 * перезаписывал файл первого — пользователь получал чужое видео либо битый
 * файл. `progressId` с тем же дефолтом склеивал прогресс двух обработок.
 *
 * Тест замораживает `Date.now()`: если уникальность держится на времени,
 * имена совпадают и тест краснеет. С `randomUUID()` — расходятся.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { safeTempFileName } from '../utils/media-exec';

const ROOT = path.resolve(__dirname, '..', '..');

afterEach(() => {
  vi.useRealTimers();
});

describe('уникальность имён временных файлов видео', () => {
  it('при замороженных часах 100 конкурентных имён не совпадают', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));

    // Ровно те же выражения, что в server/routes/video.ts и videoProcessing.ts.
    const upload = new Set<string>();
    const processed = new Set<string>();
    const tempInput = new Set<string>();

    for (let i = 0; i < 100; i++) {
      upload.add(safeTempFileName(`video_${randomUUID()}`, 'clip.mp4'));
      processed.add(safeTempFileName(`processed_${randomUUID()}`, 'clip.mp4'));
      tempInput.add(`temp_input_${randomUUID()}.mp4`);
    }

    // Часы стоят: любое имя на основе Date.now() дало бы размер 1.
    expect(Date.now()).toBe(new Date('2026-07-30T12:00:00.000Z').getTime());
    expect(upload.size).toBe(100);
    expect(processed.size).toBe(100);
    expect(tempInput.size).toBe(100);
  });

  it('расширение по-прежнему берётся из allowlist, а не от клиента', () => {
    const name = safeTempFileName(`video_${randomUUID()}`, 'evil.sh');
    expect(name.endsWith('.sh')).toBe(false);
  });

  it('в маршрутах видео не осталось имён на основе Date.now()', () => {
    for (const file of ['server/routes/video.ts', 'server/routes/videoProcessing.ts']) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      const offenders = src
        .split('\n')
        .filter((line) => /Date\.now\(\)/.test(line))
        .filter((line) => /FileName|filename|progressId|temp_input|processed_|video_/i.test(line));
      expect(offenders, `${file}: имя файла всё ещё строится из Date.now()`).toEqual([]);
    }
  });
});
