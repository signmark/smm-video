/**
 * AI-84: фрагменты секретов не должны попадать в логи.
 *
 * Найдено на проде: gemini-proxy печатал первые 10 и последние 8 символов
 * НАСТОЯЩЕГО ключа Gemini (хвост сверен со значением в global_api_keys).
 * Усечение — это не редактирование: 18 символов однозначно опознают ключ,
 * и при разборе инцидента такой ключ считается скомпрометированным.
 * Тот же паттерн жил ещё в 12 местах: валидация токенов соцсетей, маскировка
 * ключей Claude/DeepSeek/Gemini, статус админа.
 *
 * Тест стережёт ШАБЛОН, а не конкретные строки: любое появление
 * `<чтото(key|token|secret|apiKey)>.substring(...)` в одной строке с логом
 * (или в присваивании masked-/preview-переменной) — падение с именем
 * файла и строки. Разрешённая замена: длина (`len=N`) или '[redacted]' —
 * они не сужают перебор.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SERVER_ROOT = path.resolve(__dirname, '..');

/** Секрет-подобный идентификатор, у которого берут подстроку. */
const SECRET_SUBSTRING =
  /\b[A-Za-z_.]*(?:key|token|secret)[A-Za-z_]*\??\.substring\s*\(/i;

/** Строка похожа на логирование или на подготовку превью для него. */
const LOG_LIKE = /\blog(?:ger)?\b|console\.|maskedKey|keyPreview|preview/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|js)$/.test(name) && !/\.test\./.test(name)) yield full;
  }
}

describe('AI-84: секреты в логах', () => {
  it('нет усечённых фрагментов ключей/токенов в лог-строках', () => {
    const offenders: string[] = [];
    for (const file of walk(SERVER_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Контекст в 3 строки: многострочные присваивания (const keyPreview =
        //   cond ? `${key.substring(...)}` : ...) прятали substring от
        //   однострочной проверки — так ушёл в прод исходный случай AI-84.
        const ctx = lines.slice(Math.max(0, i - 1), i + 2).join('\n');
        // `x = x.substring(4)` — срез префикса у значения, не логирование:
        // это преобразование данных (например, удаление "Key " у FAL),
        // а не вывод; такие строки не считаем.
        const selfStrip = /\b([A-Za-z_.]+)\s*=\s*\1\.substring\s*\(/.test(line);
        if (!selfStrip && SECRET_SUBSTRING.test(line) && LOG_LIKE.test(ctx)) {
          offenders.push(`${path.relative(SERVER_ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders, `Фрагменты секретов в логах:\n${offenders.join('\n')}`).toEqual([]);
  });
});
