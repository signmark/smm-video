/**
 * AI-110 (task #51): в тексте ошибок пользователю не остаётся raw JSON.
 *
 * Хранитель: сканирует 8 файлов-поставщиков и утверждает, что нигде нет
 * `throw new Error(... JSON.stringify(...) ...)` и catch-`reason` с
 * `JSON.stringify(...)`. Мутация — вернуть любой из 12 прежних sites на raw
 * JSON — красит ровно это утверждение.
 *
 * (Политные логгеры/console.log с JSON.stringify — НЕ дефект: они не идут
 *  пользователю, поэтому их в хранитель не включаем.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..', '..');

const FILES = [
  'server/services/claude.ts',
  'server/services/social-platforms/vk-service.ts',
  'server/services/social-platforms/vk-stories-service.ts',
  'server/services/social-platforms/vk-clips-service.ts',
  'server/services/social-platforms/instagram-stories-service.ts',
  'server/services/social-platforms/youtube-shorts-service.ts',
  'server/services/social-platforms/youtube-video-service.ts',
  'server/routes/vk-oauth.ts',
].map((rel) => resolve(ROOT, rel));

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('AI-110: raw JSON не попадает в текст ошибки (source-boundary guard)', () => {
  it('ни один из 8 файлов не содержит throw new Error(... JSON.stringify ...)', () => {
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      // Ловим прямые вбросы raw JSON в throw-сообщение (в пределах одной строки).
      expect(src, `${file} содержит raw JSON в throw`).not.toMatch(/throw new Error\([^\n]*JSON\.stringify/);
    }
  });

  it('catch-`reason` не делает JSON.stringify объекта в текст ошибки', () => {
    const vkSvc = read('server/services/social-platforms/vk-service.ts');
    expect(vkSvc).not.toContain(': JSON.stringify(responseError)');
    expect(vkSvc).not.toContain('JSON.stringify(responseError)');
  });

  it('повторный поиск по server/ не находит throw с JSON.stringify', () => {
    const out = execSync(
      `grep -rEn "throw new Error\\(.*JSON\\.stringify" --include='*.ts' server/ | grep -v __tests__ | grep -v node_modules || true`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    // непустой вывод = нашлись прежние raw-JSON throw-места
    expect(out.trim()).toBe('');
  });
});

describe('AI-110: сохранены человекочитаемые сообщения (не пустые)', () => {
  it('Claude 403/401/остальные статусы — текст без raw JSON', () => {
    const src = read('server/services/claude.ts');
    expect(src).toContain("Request not allowed (403). Environment:");
    expect(src).toContain('Invalid API key (401).');
    expect(src).toContain('Claude API responded with status code ${response.status}.');
    expect(src).not.toContain('Response: ${JSON.stringify(response.data)}');
  });

  it('VK incomplete-data / story / clips — человекочитаемое сообщение', () => {
    const svc = read('server/services/social-platforms/vk-service.ts');
    expect(svc).toContain('VK upload server returned incomplete data');
    expect(svc).not.toContain('JSON.stringify(uploadData)');

    const stories = read('server/services/social-platforms/vk-stories-service.ts');
    expect(stories).toContain('Не удалось получить upload_result из ответа VK');
    expect(stories).toContain('VK не вернул данные Story');
    // throw-места больше не вбрасывают response.data целиком (лог — можно).
    expect(stories).not.toMatch(/throw new Error\([^\n]*JSON\.stringify\(response\.data\)/);

    const clips = read('server/services/social-platforms/vk-clips-service.ts');
    expect(clips).toContain("'Unknown VK error'");
    expect(clips).not.toContain('JSON.stringify(parsed)');
  });

  it('Instagram/YouTube/OAuth — стабильные сообщения без raw JSON', () => {
    const ig = read('server/services/social-platforms/instagram-stories-service.ts');
    expect(ig).toContain('Пустой id в ответе создания контейнера');
    expect(ig).toContain('Пустой id в ответе публикации');

    expect(read('server/services/social-platforms/youtube-shorts-service.ts')).toContain('YouTube не вернул ID видео.');
    expect(read('server/services/social-platforms/youtube-video-service.ts')).toContain('YouTube не вернул ID видео.');
    expect(read('server/routes/vk-oauth.ts')).toContain('VK не вернул access_token');
  });
});
