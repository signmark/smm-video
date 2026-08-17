/**
 * AI-65, продолжение: критические ветки перестают молчать и перестают течь.
 *
 * ЧТО БЫЛО НЕ ТАК. Три самых важных для разбора аварии места писали мимо
 * логгера, обычными console.*:
 *   1. глобальный обработчик ошибок Express — `console.error` с текстом ошибки
 *      и стеком. Мимо логгера значит мимо редактирования секретов: axios кладёт
 *      в message полный URL запроса вместе с access_token. И без reqId, то есть
 *      связать 5xx с остальными строками того же запроса нечем;
 *   2. обработчик 404 — `console.warn` с req.originalUrl, то есть с query
 *      целиком. Ссылки восстановления пароля приходят именно так;
 *   3. падение процесса — `console.error('FATAL:', error)` и сразу
 *      `process.exit(1)`. Запись в stdout докера асинхронна, поэтому та самая
 *      строка про причину падения терялась чаще всего.
 *
 * ЧТО СДЕЛАНО. Стабильные имена событий, список разрешённых полей (всё
 * остальное молча отбрасывается) и ограниченный по времени сброс перед выходом.
 *
 * RED-BEFORE. Вернуть любой из трёх console.* — краснеют сторожа исходника;
 * добавить в filterEventFields пропуск неизвестных ключей — краснеет allowlist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVENT_FIELD_ALLOWLIST,
  filterEventFields,
  flushLogs,
  logEvent,
  refreshEnvironmentConfig,
} from '../utils/logger';
import * as envDetector from '../utils/environment-detector';
import { runWithRequestContext } from '../utils/request-context';

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

beforeEach(() => {
  vi.restoreAllMocks();
  (envDetector.detectEnvironment as any).mockReturnValue(PROD);
  refreshEnvironmentConfig();
});

/** Последняя строка, ушедшая в stdout, разобранная как JSON. */
function captureEvent(fn: () => void): any {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    fn();
    const last = spy.mock.calls.at(-1)?.[0];
    return JSON.parse(String(last));
  } finally {
    spy.mockRestore();
  }
}

describe('AI-65: список разрешённых полей события', () => {
  it('запрещённое в лог не попадает', () => {
    const out = filterEventFields({
      body: { password: 'hunter2' },
      query: '?token=abc',
      cookies: 'session=1',
      authorization: 'Bearer abc.def.ghi',
      token: 'abc',
      email: 'user@example.com',
      password: 'hunter2',
      prompt: 'текст промпта',
      response: { data: 'сырой ответ Directus' },
      url: 'https://directus/items/x?access_token=abc',
    });

    expect(out).toEqual({});
  });

  it('разрешённое проходит и сохраняет тип', () => {
    const out = filterEventFields({
      route: '/api/campaigns/:id',
      method: 'POST',
      status: 500,
      durationMs: 42,
      reason: 'timeout',
      campaignId: 'c-1',
    });

    expect(out).toEqual({
      route: '/api/campaigns/:id',
      method: 'POST',
      status: 500,
      durationMs: 42,
      reason: 'timeout',
      campaignId: 'c-1',
    });
  });

  it('объекты и массивы не пропускаются даже под разрешённым именем', () => {
    // Так тело запроса и попадает в лог: кладут под безобидным ключом.
    const out = filterEventFields({ reason: { text: 'секрет' }, entityId: ['a', 'b'] });
    expect(out).toEqual({});
  });

  it('пустые значения не засоряют строку', () => {
    expect(filterEventFields({ reason: undefined, status: null, route: '/api/x' }))
      .toEqual({ route: '/api/x' });
  });

  it('длинное значение обрезается — это поле для признака, а не для содержимого', () => {
    const out = filterEventFields({ reason: 'я'.repeat(500) });
    expect((out.reason as string).length).toBeLessThanOrEqual(120);
  });

  it('секрет внутри разрешённого поля всё равно редактируется', () => {
    const out = filterEventFields({
      reason: 'GET https://directus/items/x?access_token=SUPERSECRETVALUE1234 failed',
    });
    expect(String(out.reason)).not.toContain('SUPERSECRETVALUE1234');
  });

  it('в списке разрешённых нет ни одного опасного имени', () => {
    const forbidden = ['body', 'query', 'cookies', 'headers', 'token', 'email', 'password', 'url', 'prompt', 'response'];
    for (const name of forbidden) {
      expect(EVENT_FIELD_ALLOWLIST as readonly string[]).not.toContain(name);
    }
  });
});

describe('AI-65: событие в строке лога', () => {
  it('имя события попадает отдельным полем, а не только в текст', () => {
    const line = captureEvent(() => logEvent('http.not_found', { status: 404, route: '/api/x' }, 'info'));
    expect(line.event).toBe('http.not_found');
    expect(line.status).toBe(404);
    expect(line.route).toBe('/api/x');
  });

  it('внутри запроса событие связано с ним через reqId', () => {
    const line = captureEvent(() =>
      runWithRequestContext({ reqId: 'abc123def456' }, () => logEvent('http.error', { status: 500 }, 'info')),
    );
    expect(line.reqId).toBe('abc123def456');
  });

  it('вне запроса поля reqId просто нет — пустое значение не выдумывается', () => {
    const line = captureEvent(() => logEvent('cron.finished', { count: 3 }, 'info'));
    expect(line.reqId).toBeUndefined();
    expect(line.count).toBe(3);
  });

  it('запрещённое поле не проходит и через logEvent', () => {
    const line = captureEvent(() =>
      logEvent('auth.login_failed', { email: 'user@example.com', reason: 'bad_password' } as any, 'info'),
    );
    expect(JSON.stringify(line)).not.toContain('user@example.com');
    expect(line.reason).toBe('bad_password');
  });
});

describe('AI-65: сброс лога перед падением ограничен по времени', () => {
  it('обычный случай — сброс завершается', async () => {
    await expect(flushLogs(500)).resolves.toBeUndefined();
  });

  it('зависший поток не удерживает процесс: ждём не дольше отпущенного', async () => {
    // Поток, который никогда не подтверждает запись, — ровно то, что превращает
    // падение в вечно живой процесс, если ждать сброса без ограничения.
    const original = process.stdout.write;
    (process.stdout as any).write = () => true; // callback не вызывается никогда

    try {
      const started = Date.now();
      await flushLogs(60);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      (process.stdout as any).write = original;
    }
  });
});

describe('AI-65: сторожа исходника', () => {
  const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('падение процесса пишется событием и сбрасывает лог перед выходом', () => {
    expect(index).toMatch(/logEvent\(\s*'process\.fatal'/);
    const fatalBlock = index.slice(index.indexOf('function exitAfterFatal'));
    const flushIdx = fatalBlock.indexOf('flushLogs(');
    const exitIdx = fatalBlock.indexOf('process.exit(1)');
    expect(flushIdx).toBeGreaterThan(0);
    expect(exitIdx).toBeGreaterThan(0);
    expect(flushIdx).toBeLessThan(exitIdx);
  });

  it('обработчики падения больше не печатают ошибку мимо логгера', () => {
    expect(index).not.toMatch(/console\.error\('FATAL: Uncaught Exception:'/);
    expect(index).not.toMatch(/console\.error\('FATAL: Unhandled Promise Rejection:'/);
    // Падение на старте — тот же путь: событие, ограниченный сброс, выход.
    expect(index).not.toMatch(/console\.error\(`FATAL ERROR DURING SERVER STARTUP/);
    expect(index).toMatch(/logEvent\(\s*'server\.start_failed'/);
  });

  it('404 не пишет originalUrl — там уезжает query целиком', () => {
    expect(index).not.toMatch(/console\.warn\([^)]*originalUrl/);
    expect(index).toMatch(/logEvent\(\s*'http\.not_found'/);
  });

  it('глобальный обработчик ошибок пишет событие, а не console.error со стеком', () => {
    expect(index).toMatch(/logEvent\(\s*'http\.error'/);
    expect(index).not.toMatch(/console\.error\(`🚨 \[GLOBAL-ERROR\]/);
    expect(index).not.toMatch(/if \(err\.stack\) console\.error\(err\.stack\)/);
  });

  it('маршрут в событии — шаблон, а не подставленный идентификатор', () => {
    // Иначе поиск по логам и любая метрика получают бесконечную кардинальность.
    const errBlock = index.slice(index.indexOf("logEvent(\n        'http.error'"), index.indexOf("logEvent(\n        'http.error'") + 600);
    expect(errBlock).toContain('routePattern(req.path)');
    expect(errBlock).not.toMatch(/route:\s*req\.path\b/);
  });
});
