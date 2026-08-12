/**
 * AI-101 Phase 2A+2B (task #31): обращения к Telegram идут через транспорт с
 * перебором адресов, а не голым axios и не глобальным fetch.
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
  // Phase 2A — публикация, медиа, удаление
  'server/services/social/telegram-service.ts',
  'server/services/social/telegram-s3-integration.ts',
  'server/services/social-publishing.ts',
  'server/routes/unpublish-content.ts',
  'server/services/social-platforms/telegram-service.ts',
  // Phase 2B — уведомления, платежи, проверка настроек, файлы бота
  'server/telegram-bot/index.ts',
  'server/routes/yookassa.ts',
  'server/routes/subscriptions.ts',
  'server/services/social-api-validator.ts',
  'server/services/notify-user.ts',
  'server/services/vk-token-refresh.ts',
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const TELEGRAM_HOST = 'api.telegram.org';

/**
 * Имена переменных, в значении которых лежит адрес Telegram.
 *
 * Перечислять написания (`${baseUrl}`, `this.apiBase`, `${apiBase}`) — гиблое
 * дело: каждый новый файл приносит своё имя, и список отстаёт ровно на то, что
 * ещё не сломалось. Поэтому имена выводим из самого файла.
 */
function telegramBaseNames(src: string): string[] {
  const names = new Set<string>();
  // Значение обязано быть СТРОКОЙ. Иначе под правило попадает обычное
  // const response = await tg.get(...) — имя response становится «базой
  // Telegram», и сторож считает обращением к Telegram каждую строку с этим
  // словом, включая запросы к VK и Facebook в том же файле.
  const decl = /(?:const|let|var)\s+(\w+)\s*=\s*[`'"][^;\n]*api\.telegram\.org/g;
  const field = /this\.(\w+)\s*=\s*[`'"][^;\n]*api\.telegram\.org/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src))) names.add(m[1]);
  while ((m = field.exec(src))) names.add('this.' + m[1]);
  return [...names];
}

/** Строки, где запрос к Telegram уходит мимо транспорта, — с номерами, чтобы было куда идти. */
function bareTelegramCalls(rel: string): string[] {
  const src = read(rel);
  const names = telegramBaseNames(src);
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // Мимо транспорта можно уйти двумя способами: голым axios и глобальным
    // fetch. Второй нашёлся только на ревью Phase 2A — до него сторож смотрел
    // лишь на axios и три вызова к Telegram были ему невидимы.
    const bareCall =
      /\baxios\.(post|get|patch|delete|put)\s*\(/.test(line) || /(?<![.\w])fetch\s*\(/.test(line);
    if (!bareCall) return;
    const toTelegram =
      line.includes(TELEGRAM_HOST) ||
      names.some((n) =>
        n.startsWith('this.')
          ? line.includes('${' + n.slice(5) + '}') || line.includes(n)
          : line.includes('${' + n + '}') || new RegExp('\\b' + n + '\\b').test(line),
      );
    if (toTelegram) out.push(`${rel}:${i + 1}: ${trimmed}`);
  });
  return out;
}

describe('task #31 Phase 2A+2B: обращения к Telegram идут через транспорт', () => {
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

  it('файловый путь /file/bot тоже идёт через транспорт', () => {
    // Тот же хост, другой префикс пути. Отдельное утверждение нужно не ради
    // проверки — литеральная проверка выше его и так ловит — а чтобы следующий
    // читатель знал, что про этот путь подумали, а не забыли.
    const src = read('server/telegram-bot/index.ts');
    const fileLines = src.split('\n').filter((l) => l.includes('/file/bot'));
    expect(fileLines.length, 'путь /file/bot исчез — проверь, не переехал ли он в другой файл').toBeGreaterThan(0);
    for (const line of fileLines) {
      expect(/\baxios\.(get|post)\s*\(/.test(line), `мимо транспорта: ${line.trim()}`).toBe(false);
    }
  });

  it('Telegraf создаётся только с нашим агентом', () => {
    // Библиотека ходит на api.telegram.org своим node-fetch. Без агента мимо
    // транспорта уезжает всё сразу: long polling, ответы бота, getFile —
    // и ни одна проверка вызовов этого не увидит, потому что вызовов в нашем
    // коде тут нет вовсе.
    const src = read('server/telegram-bot/index.ts');
    const positions: number[] = [];
    const re = /new Telegraf\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) positions.push(m.index);

    expect(positions.length, 'создание бота исчезло — проверь, не переехало ли в другой файл').toBeGreaterThan(0);
    for (const at of positions) {
      const call = src.slice(at, at + 400);
      expect(
        /agent:\s*getTelegramAgent\(\)/.test(call),
        'new Telegraf без agent: getTelegramAgent() — библиотека пойдёт мимо транспорта',
      ).toBe(true);
      // attachmentAgent качает произвольные URL медиа (client.js:197): наш
      // агент увёл бы их на адреса Telegram с чужим SNI.
      expect(
        /attachmentAgent/.test(call),
        'attachmentAgent не должен задаваться нашим агентом',
      ).toBe(false);
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
