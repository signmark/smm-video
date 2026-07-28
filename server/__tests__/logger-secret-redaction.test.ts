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

  it('вырезает Bearer-токен, оставляя схему', () => {
    const out = redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('вырезает Basic-креды', () => {
    const out = redactText('Authorization: Basic dXNlcjpwYXNzd29yZA==');
    expect(out).not.toContain('dXNlcjpwYXNzd29yZA');
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
