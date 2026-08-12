/**
 * AI-101 Phase 2A (task #31): публикация, медиа и удаление идут через транспорт
 * с перебором адресов, а не голым axios.
 *
 * Почему это тест на текст файлов, а не на поведение. Поведение каждого вызова
 * проверяется своими тестами, но НИ ОДИН из них не заметит, что кто-то завтра
 * допишет рядом двенадцатый вызов через голый axios — а именно так эта правка и
 * протухнет. Инцидент 11.08 случился не оттого, что транспорт был плохой:
 * транспорта просто не было на том вызове, который отказал.
 *
 * Сторож намеренно узкий: он не запрещает axios в этих файлах вовсе (там есть
 * обращения к S3, Cloudinary и Directus), он запрещает обращения К TELEGRAM
 * мимо транспорта.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** Пути, переведённые в Phase 2A. Файл из этого списка убрать нельзя — только добавить. */
const MIGRATED = [
  'server/services/social/telegram-service.ts',
  'server/services/social/telegram-s3-integration.ts',
  'server/services/social-publishing.ts',
  'server/routes/unpublish-content.ts',
  'server/services/social-platforms/telegram-service.ts',
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Строки с вызовом axios напрямую по адресу Telegram — с номерами, чтобы было куда идти. */
function bareTelegramCalls(rel: string): string[] {
  const out: string[] = [];
  read(rel).split('\n').forEach((line, i) => {
    const callsAxios = /\baxios\.(post|get|patch|delete)\s*\(/.test(line);
    if (!callsAxios) return;
    // Три способа записать один и тот же адрес: литерал, собранный baseUrl и
    // поле класса. Ловить надо все три — deletePost прятался именно за третьим.
    const toTelegram =
      line.includes('api.telegram.org') ||
      line.includes('${baseUrl}') ||
      line.includes('this.apiBase');
    if (toTelegram) out.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('task #31 Phase 2A: обращения к Telegram идут через транспорт', () => {
  it.each(MIGRATED)('%s не зовёт Telegram голым axios', (rel) => {
    expect(bareTelegramCalls(rel)).toEqual([]);
  });

  it('каждый переведённый файл действительно тянет транспорт', () => {
    for (const rel of MIGRATED) {
      const src = read(rel);
      const usesTransport =
        src.includes("from '../social-platforms/telegram-http'") ||
        src.includes("from './social-platforms/telegram-http'") ||
        src.includes("from '../services/social-platforms/telegram-http'") ||
        src.includes("from './telegram-http'");
      expect(usesTransport, `${rel} не импортирует транспорт`).toBe(true);
    }
  });

  it('в переведённых файлах не остаётся неиспользуемого импорта axios', () => {
    // Импорт, из которого больше никто не зовёт, — след недоделанного перевода:
    // следующий, кто допишет вызов, возьмёт именно его, потому что он уже здесь.
    for (const rel of MIGRATED) {
      const src = read(rel);
      if (!/^import axios from 'axios';$/m.test(src)) continue;
      const uses = (src.match(/\baxios\.(post|get|patch|delete|create|isAxiosError)\s*\(/g) || []).length;
      expect(uses, `${rel}: импорт axios есть, вызовов нет`).toBeGreaterThan(0);
    }
  });
});
