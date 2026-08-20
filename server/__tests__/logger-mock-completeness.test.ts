/**
 * Задача #34. Сторож полноты подмен журнала в тестах.
 *
 * Настоящий `log` (server/utils/logger.ts) — это функция, к которой приписаны
 * `debug`, `info`, `warn`, `error`. В тестах его долго подменяли просто на
 * `vi.fn()`. Пока код звал `log(...)`, разницы не было. Как только рутинная
 * строка переехала на `log.debug(...)` (SM-44), внутри обработчика запроса
 * начало вылетать исключение: ответ не отправлялся никогда, и десять проверок
 * границы арендатора — тех, что стерегут публикацию чужого контента — повисли
 * до таймаута.
 *
 * Самое неприятное в этой мине: она срабатывает не в том тесте, который правят.
 * Автор меняет одну строку в сервере, свои файлы прогоняет — зелено, а падает
 * чужой набор, который он не запускал. Поэтому сторож смотрит на ВСЕ подмены
 * сразу, а не на поведение одного файла.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS_DIR = __dirname;
const REQUIRED_METHODS = ['debug', 'info', 'warn', 'error'] as const;

interface LoggerMock {
  file: string;
  /** Текст фабрики подмены. */
  block: string;
  /** Весь файл: подмена может ссылаться на шпион, объявленный выше. */
  source: string;
}

/**
 * Вид кавычек к делу не относится.
 *
 * Первая редакция сторожа искала подстроку с одинарными кавычками, и подмена
 * вида vi.mock("../utils/logger", …) проходила мимо него незамеченной —
 * сторож, который стережёт только половину написаний, хуже отсутствующего:
 * он создаёт уверенность, что проверено всё.
 */
const MOCK_START = /vi\.mock\(\s*(['"`])\.\.\/utils\/logger\1/g;

/** Разбор одного файла отделён от чтения каталога — иначе его нечем проверить. */
export function collectLoggerMocksFrom(file: string, source: string): LoggerMock[] {
  const found: LoggerMock[] = [];
  const re = new RegExp(MOCK_START.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    // Двадцати строк хватает с запасом: фабрики подмены журнала короткие.
    // Брать файл целиком нельзя — сторож увидит слово «debug» где-нибудь
    // ниже по тексту и промолчит.
    found.push({ file, source, block: source.slice(match.index).split('\n').slice(0, 20).join('\n') });
  }
  return found;
}

function collectLoggerMocks(): LoggerMock[] {
  const found: LoggerMock[] = [];
  for (const file of readdirSync(TESTS_DIR)) {
    // Себя сторож не читает: в тексте его сообщений об ошибке стоят те же
    // строки, которые он ищет, и он нашёл бы сам себя.
    if (!file.endsWith('.test.ts') || file === 'logger-mock-completeness.test.ts') continue;
    found.push(...collectLoggerMocksFrom(file, readFileSync(join(TESTS_DIR, file), 'utf-8')));
  }
  return found;
}

/**
 * Достаёт выражение, которое подставляется вместо `log`: от `log:` до конца
 * значения. Считаем скобки, иначе на `Object.assign(vi.fn(), { ... })`
 * выражение оборвётся на первой же запятой внутри вызова.
 */
function logValueExpression(block: string): string | null {
  const match = /\blog\s*:\s*/.exec(block);
  if (!match) return null;
  let depth = 0;
  let out = '';
  for (let i = match.index + match[0].length; i < block.length; i++) {
    const char = block[i];
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) {
      if (depth === 0) break;
      depth--;
    } else if (char === ',' && depth === 0) break;
    out += char;
  }
  return out.trim();
}

function hasAllMethods(text: string): boolean {
  return REQUIRED_METHODS.every((method) => new RegExp(`\\b${method}\\s*[:=]`).test(text));
}

export function isComplete(mock: LoggerMock): boolean {
  // Подмена, переиспользующая настоящий модуль, полна по определению.
  if (mock.block.includes('importOriginal') || mock.block.includes('...actual')) return true;

  // Форма «const log: any = vi.fn(); log.debug = vi.fn(); …».
  if (REQUIRED_METHODS.every((m) => new RegExp(`\\blog\\.${m}\\s*=`).test(mock.block))) return true;

  const expression = logValueExpression(mock.block);
  if (expression === null) return true; // подмена не задаёт log вовсе

  if (hasAllMethods(expression)) return true;

  // Подмена ссылается на шпион, объявленный выше (обычно через vi.hoisted).
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) {
    const declaration = new RegExp(`\\b${expression}\\s*[:=]\\s*([\\s\\S]{0,300})`).exec(mock.source);
    if (declaration && hasAllMethods(declaration[1])) return true;
  }

  return false;
}

describe('подмены журнала в тестах полны', () => {
  const mocks = collectLoggerMocks();

  it('подмены вообще находятся — иначе сторож сторожит пустоту', () => {
    expect(mocks.length).toBeGreaterThan(10);
  });

  it('каждая подмена, задающая log, несёт debug, info, warn и error', () => {
    const incomplete = mocks.filter((mock) => !isComplete(mock)).map((mock) => mock.file);

    expect(
      incomplete,
      'Неполная подмена «../utils/logger». Настоящий log — это функция с ' +
        'приписанными debug/info/warn/error. Подмена без них падает не здесь, ' +
        'а в чужом наборе: вызов log.debug(...) роняет обработчик, ответ не ' +
        'уходит, и проверка висит до таймаута. Приведите подмену к виду ' +
        'log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), ' +
        'warn: vi.fn(), error: vi.fn() }).',
    ).toEqual([]);
  });

  it('подмена находится при любом виде кавычек', () => {
    // M6: до этой правки двойные кавычки уводили неполную подмену от сторожа.
    const cases: Array<[string, string]> = [
      ["одинарные", "vi.mock('../utils/logger', () => ({ log: vi.fn() }));"],
      ["двойные", 'vi.mock("../utils/logger", () => ({ log: vi.fn() }));'],
      ["обратные", 'vi.mock(`../utils/logger`, () => ({ log: vi.fn() }));'],
    ];

    for (const [name, source] of cases) {
      const mocks = collectLoggerMocksFrom(`пример-${name}.test.ts`, source);
      expect(mocks, `подмена с кавычками «${name}» не найдена`).toHaveLength(1);
      expect(isComplete(mocks[0]), `неполная подмена с кавычками «${name}» признана полной`).toBe(false);
    }
  });

  it('полная подмена в двойных кавычках сторожа не тревожит', () => {
    const source =
      'vi.mock("../utils/logger", () => ({ log: Object.assign(vi.fn(), ' +
      '{ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));';
    const mocks = collectLoggerMocksFrom('пример-полная.test.ts', source);

    expect(mocks).toHaveLength(1);
    expect(isComplete(mocks[0])).toBe(true);
  });

  it('подменённый log вызываем как функция, а не только как объект', () => {
    // Отдельный случай той же беды: log: { info, error } переживает log.info(),
    // но падает на log(...) — а так журнал зовут в большинстве мест.
    const notCallable = mocks
      .filter((mock) => {
        const expression = logValueExpression(mock.block);
        return expression !== null && expression.startsWith('{');
      })
      .map((mock) => mock.file);

    expect(notCallable, 'log подменён объектом — вызов log(...) сломается').toEqual([]);
  });
});
