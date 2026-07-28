/**
 * Вызовы ffmpeg/ffprobe больше не собираются строкой — значит инъекции команд нет.
 *
 * Находки ревью 2026-07-28 (три P0): «расширение» из URL, `originalname` из multipart
 * и `localPath` из тела запроса попадали в ``exec(`ffprobe … "${path}"`)``. Двойные
 * кавычки от `$( )` не защищают — шелл выполняет подстановку внутри них.
 *
 * Ключевой тест здесь — `не выполняет подстановку команд`: он реально запускает
 * ffprobe на файле, в имени которого сидит `$(...)`, и проверяет, что побочного
 * эффекта не произошло. Мок бы это не доказал.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  UnsafeMediaPathError,
  resolveLocalMediaPath,
  runFfprobe,
  safeMediaExtension,
  safeTempFileName,
  sanitizeFileLabel,
} from '../utils/media-exec';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-exec-test-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('safeMediaExtension', () => {
  it('оставляет обычные расширения', () => {
    expect(safeMediaExtension('https://cdn.example.com/clip.mp4')).toBe('.mp4');
    expect(safeMediaExtension('https://cdn.example.com/clip.webm')).toBe('.webm');
    expect(safeMediaExtension('/tmp/uploads/clip.MOV')).toBe('.mov');
  });

  it('срезает подстановку команд из pathname', () => {
    // URL-класс не энкодит `$ ( ) ; &` в pathname — раньше это ехало прямо в путь.
    expect(safeMediaExtension('http://attacker.test/a.$(id)')).toBe('.mp4');
    expect(safeMediaExtension('http://attacker.test/a.mp4;id')).toBe('.mp4');
    expect(safeMediaExtension('http://attacker.test/a.`id`')).toBe('.mp4');
    expect(safeMediaExtension('http://attacker.test/a.mp4 && curl evil.test')).toBe('.mp4');
  });

  it('игнорирует query и fragment', () => {
    expect(safeMediaExtension('https://cdn.example.com/clip.webm?token=x.sh')).toBe('.webm');
    expect(safeMediaExtension('https://cdn.example.com/clip.mp4#a.$(id)')).toBe('.mp4');
  });

  it('подставляет запасное расширение, когда его нет', () => {
    expect(safeMediaExtension('https://cdn.example.com/stream')).toBe('.mp4');
    expect(safeMediaExtension('')).toBe('.mp4');
    expect(safeMediaExtension('.bashrc')).toBe('.mp4');
  });
});

describe('safeTempFileName', () => {
  it('не пускает имя клиента в путь', () => {
    const name = safeTempFileName('11111111-2222-3333-4444-555555555555', 'a$(id).mp4');
    expect(name).toBe('11111111-2222-3333-4444-555555555555.mp4');
  });

  it('обезвреживает traversal и переводы строк', () => {
    for (const original of ['../../etc/passwd', '../../../root/.ssh/id_rsa.mp4', 'a\nid.mp4', 'a\0.mp4']) {
      const name = safeTempFileName('abc', original);
      expect(name).not.toContain('..');
      expect(name).not.toContain('/');
      expect(name).not.toContain('\n');
      expect(name).not.toContain('\0');
      expect(path.basename(name)).toBe(name);
    }
  });
});

describe('sanitizeFileLabel', () => {
  it('не даёт выйти за пределы папки в ключе S3', () => {
    expect(sanitizeFileLabel('../../secret.mp4')).toBe('secret.mp4');
    expect(sanitizeFileLabel('a/b/c.mp4')).toBe('c.mp4');
    expect(sanitizeFileLabel('')).toBe('file');
  });
});

describe('resolveLocalMediaPath', () => {
  it('пропускает файл во временном каталоге', () => {
    const file = path.join(workDir, 'clip.mp4');
    fs.writeFileSync(file, 'x');
    expect(resolveLocalMediaPath(file)).toBe(fs.realpathSync(file));
  });

  it('отказывает в файле вне разрешённых каталогов', () => {
    expect(() => resolveLocalMediaPath('/etc/passwd')).toThrow(UnsafeMediaPathError);
    expect(() => resolveLocalMediaPath('/etc/passwd')).toThrow(/вне разрешённого каталога/);
  });

  it('отказывает в traversal через временный каталог', () => {
    expect(() => resolveLocalMediaPath(path.join(workDir, '..', '..', 'etc', 'passwd')))
      .toThrow(UnsafeMediaPathError);
  });

  it('раскрывает симлинк до проверки', () => {
    // Иначе ссылка внутри temp на /etc/passwd прошла бы проверку каталога.
    const link = path.join(workDir, 'link.mp4');
    fs.symlinkSync('/etc/passwd', link);
    expect(() => resolveLocalMediaPath(link)).toThrow(/вне разрешённого каталога/);
  });

  it('отказывает в каталоге и несуществующем пути', () => {
    expect(() => resolveLocalMediaPath(workDir)).toThrow(/не указывает на файл/);
    expect(() => resolveLocalMediaPath(path.join(workDir, 'нет.mp4'))).toThrow(/не найден/);
  });

  it('отказывает в пустом пути и нулевом байте', () => {
    expect(() => resolveLocalMediaPath('')).toThrow(UnsafeMediaPathError);
    expect(() => resolveLocalMediaPath('/tmp/a\0.mp4')).toThrow(/Недопустимый путь/);
  });
});

describe('runFfprobe', () => {
  it('не выполняет подстановку команд из имени файла', async () => {
    // Имя файла, которое при сборке строкой дало бы выполнение команды даже
    // внутри двойных кавычек. Команда пишет маркер рядом — в cwd процесса.
    const hostile = path.join(workDir, 'clip.$(touch pwned).mp4');
    fs.writeFileSync(hostile, 'not a real video');

    // ffprobe откажется разбирать не-видео — это ожидаемо и не важно.
    await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', hostile], {
      timeout: 30_000,
      cwd: workDir,
    }).catch(() => undefined);

    expect(fs.existsSync(path.join(workDir, 'pwned'))).toBe(false);
    // Файл с враждебным именем на месте — значит аргумент дошёл до ffprobe буквально.
    expect(fs.existsSync(hostile)).toBe(true);
  }, 40_000);

  it('передаёт аргумент как есть, не разбивая по пробелам', async () => {
    const spaced = path.join(workDir, 'clip with spaces.mp4');
    fs.writeFileSync(spaced, 'not a real video');

    const error = await runFfprobe(['-v', 'error', '-show_format', spaced], { timeout: 30_000 })
      .then(() => null)
      .catch((e: any) => e);

    // Файл найден (иначе была бы «No such file»), просто не разобран как медиа.
    expect(String(error?.stderr ?? '')).not.toMatch(/No such file or directory/i);
  }, 40_000);

  it('отбрасывает не-строковые аргументы', async () => {
    await expect(runFfprobe(['-v', undefined as any, 'x'])).rejects.toThrow(TypeError);
  });
});
