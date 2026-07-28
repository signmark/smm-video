/**
 * Единая точка запуска ffmpeg/ffprobe и разбора путей к медиафайлам.
 *
 * Зачем отдельный модуль (находки ревью 2026-07-28, три P0):
 *
 *  1. **Инъекция команд.** Везде вызовы собирались строкой — ``exec(`ffprobe … "${filePath}"`)``.
 *     Кавычки вокруг пути от шелла не спасают: путь склеивался из данных запроса
 *     (расширение из URL, `originalname` из multipart), а `$( )` внутри двойных
 *     кавычек шелл выполняет. URL вида `http://attacker/a.$(id)` давал выполнение
 *     команд от лица приложения. Здесь shell не участвует вообще: `execFile`
 *     получает массив аргументов и передаёт их процессу напрямую.
 *
 *  2. **Расширение как источник имени файла.** `pathname` не энкодит `$ ( ) ; &`,
 *     поэтому «расширение» — это произвольная строка. Теперь оно проходит через
 *     allowlist, а не через проверку «есть ли точка».
 *
 *  3. **Произвольный путь снаружи.** `localPath` из тела запроса шёл в `ffmpeg -i`
 *     как есть: и чтение чужих файлов, и (через протоколы ffmpeg) обращения по сети.
 *     `resolveLocalMediaPath` пускает только внутрь разрешённых временных каталогов.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execFileAsync = promisify(execFile);

/** Вывод ffprobe в JSON бывает объёмным на файлах с сотнями потоков. */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export const DEFAULT_MEDIA_EXTENSION = '.mp4';

/**
 * Расширения, которые нам достаточно уметь принимать. Всё остальное приводится к
 * `.mp4` — формат всё равно определяет ffprobe по содержимому, а не по имени.
 */
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.flv',
  '.mpg', '.mpeg', '.m4v', '.3gp', '.ogv', '.ts', '.m3u8',
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
]);

export interface RunMediaToolOptions {
  /** Максимальное время работы процесса, мс. */
  timeout?: number;
  maxBuffer?: number;
  /** Рабочий каталог процесса. */
  cwd?: string;
}

/** Запускает ffprobe без участия шелла. Аргументы уходят процессу как есть. */
export function runFfprobe(args: string[], options: RunMediaToolOptions = {}) {
  return runMediaTool('ffprobe', args, options);
}

/** Запускает ffmpeg без участия шелла. */
export function runFfmpeg(args: string[], options: RunMediaToolOptions = {}) {
  return runMediaTool('ffmpeg', args, options);
}

async function runMediaTool(
  bin: 'ffmpeg' | 'ffprobe',
  args: string[],
  options: RunMediaToolOptions,
): Promise<{ stdout: string; stderr: string }> {
  // Страховка от `undefined`/чисел, случайно попавших в массив: execFile такое
  // приводит к строке молча, а нам нужен явный отказ.
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new TypeError(`${bin}: аргумент должен быть строкой, получено ${typeof arg}`);
    }
  }

  return execFileAsync(bin, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    cwd: options.cwd,
  });
}

/** Проверяет, что ffmpeg вообще есть в системе. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const { stdout } = await runFfmpeg(['-version'], { timeout: 15_000 });
    return stdout.includes('ffmpeg version');
  } catch {
    return false;
  }
}

/**
 * Достаёт расширение из URL или имени файла и пропускает через allowlist.
 *
 * Всё, чего нет в списке (включая `.$(id)`, `.mp4;rm -rf /` и пустую строку),
 * заменяется на `fallback` — расширение не влияет на разбор, только на имя
 * временного файла.
 */
export function safeMediaExtension(
  source: string,
  fallback: string = DEFAULT_MEDIA_EXTENSION,
): string {
  const raw = extractRawExtension(source);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  return ALLOWED_MEDIA_EXTENSIONS.has(normalized) ? normalized : fallback;
}

function extractRawExtension(source: string): string | null {
  if (typeof source !== 'string' || !source) return null;

  let candidate = source;
  try {
    // Для URL берём только pathname: query и fragment к имени файла не относятся.
    candidate = new URL(source).pathname;
  } catch {
    // Не URL — значит обычное имя файла или путь.
  }

  const base = path.basename(candidate);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;

  return base.slice(dot);
}

/**
 * Собирает безопасное имя временного файла: уникальная часть, которую задаём мы,
 * плюс расширение из allowlist. Имя, пришедшее от пользователя, в путь не попадает
 * никогда — ни `../`, ни `$(…)`, ни пробелов и переводов строки.
 */
export function safeTempFileName(uniquePart: string, source: string, fallback?: string): string {
  const safeUnique = uniquePart.replace(/[^a-zA-Z0-9._-]/g, '');
  return `${safeUnique || 'file'}${safeMediaExtension(source, fallback)}`;
}

/**
 * Приводит имя файла к безопасному виду, сохраняя читаемость (для ключей S3 и
 * заголовков, но не для путей в файловой системе).
 */
export function sanitizeFileLabel(name: string, fallback = 'file'): string {
  if (typeof name !== 'string') return fallback;

  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  const trimmed = base.slice(0, 120);
  return trimmed || fallback;
}

export class UnsafeMediaPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeMediaPathError';
  }
}

/** Каталоги, из которых допустимо брать локальные файлы на конвертацию. */
function defaultAllowedRoots(): string[] {
  return [os.tmpdir(), '/tmp'];
}

/**
 * Разрешает путь к локальному медиафайлу, пришедший снаружи.
 *
 * Требования: путь абсолютный после нормализации, лежит внутри одного из
 * разрешённых каталогов и указывает на обычный файл. Симлинки раскрываются до
 * проверки — иначе ссылка из temp на `/etc/shadow` обошла бы её.
 */
export function resolveLocalMediaPath(rawPath: string, allowedRoots: string[] = defaultAllowedRoots()): string {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new UnsafeMediaPathError('Путь к файлу не указан');
  }
  if (rawPath.includes('\0')) {
    throw new UnsafeMediaPathError('Недопустимый путь к файлу');
  }

  const absolute = path.resolve(rawPath);

  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new UnsafeMediaPathError('Файл не найден');
  }

  const roots = allowedRoots.map(root => {
    try {
      return fs.realpathSync(path.resolve(root));
    } catch {
      return path.resolve(root);
    }
  });

  const inAllowedRoot = roots.some(root => real === root || real.startsWith(root + path.sep));
  if (!inAllowedRoot) {
    throw new UnsafeMediaPathError('Файл вне разрешённого каталога');
  }

  if (!fs.statSync(real).isFile()) {
    throw new UnsafeMediaPathError('Путь не указывает на файл');
  }

  return real;
}
