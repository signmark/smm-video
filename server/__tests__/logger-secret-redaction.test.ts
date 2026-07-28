/**
 * Редакция секретов в логах.
 *
 * Находка ревью 2026-07-28: redact() применялся только к структурированной ошибке,
 * а `msg` сериализовался как есть — `access_token=FAKE_SECRET` попадал в production
 * JSON целиком. Реальный вызов в server/api/facebook-webhook-direct.ts писал полный
 * ответ /me/accounts, где у каждой страницы лежит её page access token.
 *
 * Проверяется и вывод, и кольцевой буфер recentLogs: его отдаёт /api/debug/logs,
 * так что секрет там — такая же утечка, как в stdout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { log, error, warn, info, refreshEnvironmentConfig, getRecentLogs, redactText } from '../utils/logger';
import * as envDetector from '../utils/environment-detector';

vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: vi.fn().mockReturnValue({
    environment: 'production',
    verboseLogs: false,
    debugScheduler: false,
    logLevel: 'info',
    directusUrl: 'http://test',
  }),
}));

const PROD = {
  environment: 'production',
  verboseLogs: false,
  debugScheduler: false,
  logLevel: 'info',
  directusUrl: 'http://test',
};

const DEV = { ...PROD, environment: 'development', logLevel: 'debug' };

let consoleSpy: any;

function useEnv(cfg: Record<string, unknown>) {
  (envDetector.detectEnvironment as any).mockReturnValue(cfg);
  refreshEnvironmentConfig();
}

beforeEach(() => {
  vi.clearAllMocks();
  useEnv(PROD);
  consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

/** Последняя строка, ушедшая в console.log. */
function lastLog(): string {
  return String(consoleSpy.log.mock.calls.at(-1)?.[0] ?? '');
}

describe('redactText — строковые сообщения', () => {
  it.each([
    ['access_token=FAKE_SECRET_VALUE', 'FAKE_SECRET_VALUE'],
    ['refresh_token=RT_abc123', 'RT_abc123'],
    ['password=hunter2', 'hunter2'],
    ['api_key=sk-live-9999', 'sk-live-9999'],
    ['apiKey=zzz-secret-zzz', 'zzz-secret-zzz'],
    ['client_secret=CS_TOPSECRET', 'CS_TOPSECRET'],
    ['cookie=session=abcdef123456', 'abcdef123456'],
    ['authorization: Token_ABCDEF', 'Token_ABCDEF'],
  ])('вырезает значение из %s', (input, secret) => {
    const out = redactText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  // Фикстуры намеренно НЕ похожи на настоящие креды: base64-подобная строка вида
  // «Bearer eyJ...» ловится секрет-сканерами как утёкший JWT. Инцидент был бы ложным,
  // но регулярно повторяющийся ложный алерт приучает не смотреть на алерты вообще.
  it('вырезает Bearer-токен, оставляя схему', () => {
    const out = redactText('Authorization: Bearer FAKE-BEARER-FOR-TEST-000000');
    expect(out).not.toContain('FAKE-BEARER-FOR-TEST');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('вырезает Basic-креды', () => {
    const out = redactText('Authorization: Basic FAKE-BASIC-FOR-TEST-000000');
    expect(out).not.toContain('FAKE-BASIC-FOR-TEST');
    expect(out).toContain('Basic [REDACTED]');
  });

  it('вырезает секрет из JSON-строки', () => {
    const out = redactText('{"id":"123","access_token":"EAAG_PAGE_TOKEN","name":"Страница"}');
    expect(out).not.toContain('EAAG_PAGE_TOKEN');
    expect(out).toContain('[REDACTED]');
    // Полезное остаётся читаемым
    expect(out).toContain('"id":"123"');
    expect(out).toContain('Страница');
  });

  it('вырезает токен из URL с query', () => {
    const out = redactText('GET https://graph.facebook.com/me/accounts?access_token=EAABBCC123&fields=id');
    expect(out).not.toContain('EAABBCC123');
    expect(out).toContain('graph.facebook.com/me/accounts');
    expect(out).toContain('fields=id'); // несекретный параметр уцелел
  });

  it('не превращает обычное сообщение в [REDACTED]', () => {
    const msg = 'Публикация в Telegram завершена: 3 поста, 0 ошибок';
    expect(redactText(msg)).toBe(msg);
  });

  it('идемпотентна — повторный проход не плодит скобки', () => {
    const once = redactText('access_token=SECRET');
    expect(redactText(once)).toBe(once);
  });
});

describe('production output', () => {
  it('секрет из msg не уходит в stdout', () => {
    log('Ответ Facebook: access_token=FAKE_SECRET_VALUE', 'facebook', 'info');

    const line = lastLog();
    expect(line).not.toContain('FAKE_SECRET_VALUE');
    expect(line).toContain('[REDACTED]');
  });

  it('секрет из msg не уходит в recentLogs (его отдаёт /api/debug/logs)', () => {
    log('token=RING_BUFFER_SECRET', 'test', 'info');

    const buffered = getRecentLogs().join('\n');
    expect(buffered).not.toContain('RING_BUFFER_SECRET');
    expect(buffered).toContain('[REDACTED]');
  });

  it('секрет в warn и error тоже вырезается', () => {
    warn('client_secret=WARN_SECRET', 'test');
    error('password=ERROR_SECRET', undefined, 'test');

    const all = [
      ...consoleSpy.warn.mock.calls.flat(),
      ...consoleSpy.error.mock.calls.flat(),
    ].map(String).join('\n');

    expect(all).not.toContain('WARN_SECRET');
    expect(all).not.toContain('ERROR_SECRET');
  });

  it('секрет в message ошибки вырезается', () => {
    error('Запрос упал', new Error('Request to /me?access_token=ERR_MSG_SECRET failed'), 'test');

    const line = String(consoleSpy.error.mock.calls.at(-1)?.[0] ?? '');
    expect(line).not.toContain('ERR_MSG_SECRET');
  });

  it('секрет в теле ответа ошибки вырезается', () => {
    const err: any = new Error('boom');
    err.response = { status: 400, data: { access_token: 'BODY_SECRET', error: 'invalid' } };
    error('Facebook отказал', err, 'test');

    const line = String(consoleSpy.error.mock.calls.at(-1)?.[0] ?? '');
    expect(line).not.toContain('BODY_SECRET');
    expect(line).toContain('invalid'); // диагностика уцелела
  });

  it('секрет в строковом значении вложенного объекта вырезается', () => {
    const err: any = new Error('boom');
    err.response = { status: 400, data: { detail: 'failed for access_token=NESTED_STRING_SECRET' } };
    error('Отказ', err, 'test');

    const line = String(consoleSpy.error.mock.calls.at(-1)?.[0] ?? '');
    expect(line).not.toContain('NESTED_STRING_SECRET');
  });
});

describe('development output', () => {
  it('секрет не уходит и в человекочитаемый вывод', () => {
    useEnv(DEV);
    vi.clearAllMocks();

    info('access_token=DEV_SECRET_VALUE', 'test');

    expect(lastLog()).not.toContain('DEV_SECRET_VALUE');
    expect(getRecentLogs().join('\n')).not.toContain('DEV_SECRET_VALUE');
  });
});

/**
 * Ключ в query-параметре с «несекретным» именем.
 *
 * Находка ревью 2026-07-28 (P1): Gemini передаёт ключ параметром `key`, а KV_PAIR
 * требует, чтобы имя параметра содержало слово из SECRET_WORD. Поэтому сетевая
 * ошибка node-fetch с полным URL уносила GEMINI_API_KEY в логи целиком.
 */
describe('redactText — секрет в query-параметре key=', () => {
  it('вырезает ключ Gemini из URL', () => {
    const out = redactText(
      'FetchError: request to https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyFAKE_TEST_KEY_000 failed',
    );

    expect(out).not.toContain('AIzaSyFAKE_TEST_KEY_000');
    expect(out).toContain('key=[REDACTED]');
    // Остальная часть сообщения должна остаться читаемой.
    expect(out).toContain('generativelanguage.googleapis.com');
    expect(out).toContain('FetchError');
  });

  it('режет и другие «несекретные» имена параметров', () => {
    for (const param of ['sig', 'signature', 'auth', 'code']) {
      const out = redactText(`https://api.test/x?${param}=FAKE_VALUE_000&page=2`);
      expect(out).not.toContain('FAKE_VALUE_000');
      expect(out).toContain(`${param}=[REDACTED]`);
      // Несекретные параметры не трогаем.
      expect(out).toContain('page=2');
    }
  });

  it('не трогает key= вне query-строки', () => {
    // Иначе редакция съела бы обычные отладочные строки вида `key=value`.
    const msg = 'cache lookup: key=user-42 hit';
    expect(redactText(msg)).toBe(msg);
  });

  it('идемпотентна', () => {
    const once = redactText('https://api.test/x?key=SECRET');
    expect(redactText(once)).toBe(once);
  });
});
