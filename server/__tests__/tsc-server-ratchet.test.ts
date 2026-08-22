/**
 * Храповик полного серверного tsc (AI-38, 09.08.2026).
 *
 * ЗАЧЕМ. `npm run check` смотрит СЕМЬ файлов из tsconfig.critical.json и на
 * остальной сервер не смотрит вообще, а esbuild типы не проверяет в принципе —
 * он их стирает. Поэтому зелёная сборка не значит, что код исполним: 07.08 в
 * main уехал файл с импортом внутри тела класса, и поймал это только build.
 *
 * Довести полный tsc до нуля — работа не на один день: сейчас 468 ошибок в 95
 * файлах. Пока она идёт, число продолжает расти: в тикете AI-38 от 24.07 стояло
 * 399 ошибок в 80 файлах, то есть за две недели прибавилось 69. Храповик
 * фиксирует текущее число и падает, если оно выросло. Чинить можно любыми
 * порциями, каждая порция опускает планку.
 *
 * Как понижать планку: запустить `scripts/tsc-ratchet.sh --update`.
 * Поднимать планку нельзя — если понадобилось, значит в сервер добавили
 * непроверенный тип, и правильный шаг противоположный.
 *
 * Тест НЕ утверждает, что типы корректны. Он утверждает только одно:
 * их не стало хуже.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Читаем планку из файла, а не из хардкода. Формат файла:
 *   config=tsconfig.server-full.json
 *   count=<число>
 *
 * Тот же файл читает `scripts/tsc-ratchet.sh`, так что тест и гейт используют
 * одно и то же число. Менять планку — один коммит в одном месте.
 */
const ROOT = join(__dirname, '..', '..');
const BASELINE_FILE = join(ROOT, 'scripts', 'tsc-ratchet.baseline');
const TSCONFIG = 'tsconfig.server-full.json';

function readBaseline(): number {
  const raw = readFileSync(BASELINE_FILE, 'utf-8');
  let config = '';
  let count = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) throw new Error(`Испорченная планка ${BASELINE_FILE}: строка без '=': ${trimmed}`);
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === 'config') config = value;
    else if (key === 'count') count = value;
    else throw new Error(`Испорченная планка ${BASELINE_FILE}: неизвестное поле '${key}'`);
  }
  if (!config || !count) throw new Error(`Испорченная планка ${BASELINE_FILE}: нужны оба поля config= и count=`);
  if (config !== TSCONFIG) throw new Error(`Планка снята конфигурацией '${config}', а тест гоняет '${TSCONFIG}'`);
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`Испорченная планка ${BASELINE_FILE}: count='${count}' не целое неотрицательное число`);
  return n;
}

const BASELINE = readBaseline();

function countServerTypeErrors(): { count: number; sample: string[] } {
  let output = '';
  try {
    // Локальный бинарь, а не `npx`: через npx тот же прогон занимал 71 секунду
    // вместо 15 — эти 56 секунд платил бы каждый прогон гейта у всей команды.
    execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.server-full.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // tsc выходит с ненулевым кодом, когда ошибки есть, — это ожидаемо.
    const e = err as { stdout?: string; stderr?: string };
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const lines = output.split('\n').filter((l) => /error TS\d+:/.test(l));
  return { count: lines.length, sample: lines.slice(0, 5) };
}

describe('AI-38: полный серверный tsc не деградирует', () => {
  it(`ошибок типов не больше планки (${BASELINE})`, () => {
    const { count, sample } = countServerTypeErrors();
    expect(
      count,
      count > BASELINE
        ? `Ошибок типов стало БОЛЬШЕ: ${count} против планки ${BASELINE}.\n` +
          `Починить новые или, если правка тут ни при чём, разобраться почему выросло.\nПримеры:\n${sample.join('\n')}`
        : `Ошибок стало МЕНЬШЕ: ${count}. Опусти планку: scripts/tsc-ratchet.sh --update`,
    ).toBe(BASELINE);
  }, 120_000);
});
