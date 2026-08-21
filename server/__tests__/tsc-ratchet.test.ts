/**
 * Планка ошибок типизации сервера — поведение скрипта scripts/tsc-ratchet.sh.
 *
 * ПОЧЕМУ БЕЗ НАСТОЯЩЕГО tsc. Полный прогон типизации сервера идёт минуты, а
 * проверить надо десяток исходов, включая те, где компилятор падает. Скрипт
 * получает путь к компилятору переменной окружения, поэтому тест подставляет
 * поддельный: он печатает ровно столько строк вида `error TS`, сколько задано,
 * либо изображает падение. Проверяется НАСТОЯЩИЙ скрипт целиком, а не его
 * пересказ, — подменена только внешняя команда.
 *
 * Коды выхода различаются намеренно: 0 — норма, 1 — ошибок стало больше,
 * 2 — прогон не состоялся. Тест держит именно это различие: «просто упало»
 * и «стало хуже» требуют разной реакции.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/tsc-ratchet.sh');
const CONFIG = 'tsconfig.server-full.json';

let dir: string;

/**
 * Поддельный компилятор: печатает `count` строк ошибок и завершается как tsc.
 *
 * Половина ошибок приходится на один файл намеренно: список «файлы с наибольшим
 * числом ошибок» должен иметь однозначный первый элемент, иначе тест на этот
 * список зависел бы от того, в каком порядке `sort` разложил одинаковые числа.
 */
function fakeCompiler(count: number): string {
  const file = path.join(dir, 'fake-tsc.sh');
  const concentrated = Math.ceil(count / 2);
  writeFileSync(
    file,
    `#!/bin/sh
i=0
while [ $i -lt ${count} ]; do
  if [ $i -lt ${concentrated} ]; then
    echo "server/главный.ts(1,1): error TS0000: выдуманная ошибка"
  else
    echo "server/файл$i.ts(1,1): error TS0000: выдуманная ошибка"
  fi
  i=$((i+1))
done
[ ${count} -gt 0 ] && exit 2
exit 0
`,
  );
  chmodSync(file, 0o755);
  return file;
}

/**
 * Компилятор с большим числом РАЗНЫХ файлов: нужен там, где проверяется
 * поведение при досрочно закрытом конвейере вывода.
 */
function manyFilesCompiler(count: number): string {
  const file = path.join(dir, 'many-tsc.sh');
  writeFileSync(
    file,
    `#!/bin/sh
i=0
while [ $i -lt ${count} ]; do
  echo "server/файл$i.ts(1,1): error TS0000: выдуманная ошибка"
  i=$((i+1))
done
exit 2
`,
  );
  chmodSync(file, 0o755);
  return file;
}

/** Компилятор, который не запустился вовсе: ни одной строки об ошибках типов. */
function crashingCompiler(message: string, code: number): string {
  const file = path.join(dir, 'crash-tsc.sh');
  writeFileSync(file, `#!/bin/sh\necho "${message}" >&2\nexit ${code}\n`);
  chmodSync(file, 0o755);
  return file;
}

function baseline(content: string): string {
  const file = path.join(dir, 'baseline');
  writeFileSync(file, content);
  return file;
}

function run(opts: {
  errors?: number;
  compiler?: string;
  baselineFile?: string;
  config?: string;
  args?: string[];
}) {
  const compiler = opts.compiler ?? fakeCompiler(opts.errors ?? 0);
  return spawnSync('bash', [SCRIPT, ...(opts.args ?? [])], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      RATCHET_REPO: dir,
      RATCHET_FILE: opts.baselineFile ?? path.join(dir, 'baseline'),
      RATCHET_TSCONFIG: opts.config ?? CONFIG,
      RATCHET_NPX: compiler,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  // Скрипт отказывается работать без файла конфигурации — он должен
  // существовать, содержимое ему не важно, компилятор всё равно поддельный.
  writeFileSync(path.join(dir, CONFIG), '{}');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('планка типизации: сравнение с записанным числом', () => {
  it('равное число — код 0', () => {
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 388 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('388');
  });

  it('на одну ошибку больше — код 1 и список файлов', () => {
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 389 });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Стало больше на 1');
    expect(r.stdout).toContain('server/главный.ts');
  });

  it('меньше — код 0 и предложение опустить планку', () => {
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 300 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Стало меньше на 88');
  });

  it('режим отчёта при росте — код 0, но рост всё равно назван', () => {
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 400, args: ['--report'] });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Стало больше на 12');
  });

  it('рост при выводе в закрытый поток не превращается в 141', () => {
    // Регрессия на обрезку списка: `head` закрывал конвейер досрочно, upstream
    // получал SIGPIPE, и под pipefail скрипт умирал кодом 141 вместо честного 1.
    //
    // Три тысячи РАЗНЫХ файлов, а не полсотни: чтобы обрезка гарантированно
    // закрыла конвейер раньше, чем upstream допишет свой вывод. На коротком
    // списке гонка разрешалась в обе стороны, и регрессия не ловилась.
    baseline(`config=${CONFIG}\ncount=1\n`);
    const compiler = manyFilesCompiler(3000);
    const r = spawnSync('bash', ['-c', `bash "${SCRIPT}" > /dev/null 2>&1; echo $?`], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        RATCHET_REPO: dir,
        RATCHET_FILE: path.join(dir, 'baseline'),
        RATCHET_TSCONFIG: CONFIG,
        RATCHET_NPX: compiler,
      },
    });
    expect(r.stdout.trim()).toBe('1');
  });
});

describe('планка типизации: прогон не состоялся — это не «стало хуже»', () => {
  it('конфигурация в планке не совпадает с прогоном — код 2', () => {
    baseline('config=tsconfig.critical.json\ncount=388\n');
    const r = run({ errors: 0 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Сравнивать эти числа нельзя');
  });

  it('незнакомое поле в планке — код 2', () => {
    baseline(`config=${CONFIG}\ncount=388\nthreshold=999\n`);
    const r = run({ errors: 388 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('неизвестное поле');
  });

  it('нет обязательного поля — код 2', () => {
    baseline('count=388\n');
    const r = run({ errors: 388 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('оба поля');
  });

  it('count не число — код 2', () => {
    baseline(`config=${CONFIG}\ncount=много\n`);
    const r = run({ errors: 388 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('не число');
  });

  it('файла планки нет вовсе — код 2', () => {
    const r = run({ errors: 388, baselineFile: path.join(dir, 'нет-такого') });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Нет файла планки');
  });

  it('компилятор не запустился — код 2, а не зелёный ноль', () => {
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ compiler: crashingCompiler('Cannot find module typescript', 1) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Проверка не выполнилась');
  });

  it('пустой вывод с ненулевым кодом — тоже код 2', () => {
    // Молчаливый ноль: ошибок «не найдено», потому что компилятор не работал.
    baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ compiler: crashingCompiler('', 9) });
    expect(r.status).toBe(2);
  });
});

describe('планка типизации: запись', () => {
  it('меньшее число записывается вместе с конфигурацией', () => {
    const file = baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 300, args: ['--update'] });
    expect(r.status).toBe(0);
    expect(readFileSync(file, 'utf-8')).toBe(`config=${CONFIG}\ncount=300\n`);
  });

  it('повышение отвергается, файл остаётся прежним', () => {
    const file = baseline(`config=${CONFIG}\ncount=388\n`);
    const before = readFileSync(file, 'utf-8');
    const r = run({ errors: 400, args: ['--update'] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Отказываюсь поднимать планку');
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });

  it('равное число записывается без возражений', () => {
    const file = baseline(`config=${CONFIG}\ncount=388\n`);
    const r = run({ errors: 388, args: ['--update'] });
    expect(r.status).toBe(0);
    expect(readFileSync(file, 'utf-8')).toContain('count=388');
  });
});
