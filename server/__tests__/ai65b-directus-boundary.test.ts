/**
 * AI-65, этап 3: граница с Directus перестаёт молчать — и перестаёт течь.
 *
 * ЧТО БЫЛО НЕ ТАК. Через DirectusCrud ходит почти весь продукт, и до сих пор
 * неуспешный ответ просто бросался дальше и умирал в ближайшем catch. Именно
 * поэтому AI-39 и AI-64 не оставили в логе ни строки. А там, где запись всё же
 * была (повторы в executeWithRetry), в неё уходило ЦЕЛИКОМ тело ответа Directus
 * и текст ошибки axios — то есть содержимое записей и полный URL с параметрами.
 * Ровно то, что задача запрещает.
 *
 * ЧТО СДЕЛАНО. Одна запись на отказ, в ней только коллекция, код состояния и
 * стабильная машинная причина. Тело и текст ошибки не пишутся вовсе.
 *
 * RED-BEFORE. Вернуть console.* с `JSON.stringify(error.response.data)` —
 * краснеет сторож исходника; убрать try/catch из executeRequest — краснеют
 * поведенческие проверки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('axios', () => ({
  default: Object.assign(vi.fn(), {
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
    get: vi.fn(),
    post: vi.fn(),
  }),
}));
vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getAdminToken: vi.fn().mockResolvedValue('admin-token-value') },
}));

import axios from 'axios';
import {
  collectionFromUrl,
  directusErrorCode,
  levelForDirectusFailure,
  directusCrud,
} from '../services/directus-crud';
import { refreshEnvironmentConfig } from '../utils/logger';
import * as envDetector from '../utils/environment-detector';

vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: vi.fn().mockReturnValue({
    environment: 'production',
    verboseLogs: false,
    debugScheduler: false,
    logLevel: 'info',
    directusUrl: 'http://directus.test',
  }),
}));

const PROD = {
  environment: 'production',
  verboseLogs: false,
  debugScheduler: false,
  logLevel: 'info',
  directusUrl: 'http://directus.test',
};

/** Отказ Directus в том виде, в каком его отдаёт axios. */
function directusError(status: number, code: string, body?: any) {
  const err: any = new Error(
    `Request failed with status code ${status} at http://directus.test/items/campaign_content?access_token=SECRETTOKENVALUE1`,
  );
  err.response = {
    status,
    data: body ?? { errors: [{ message: 'Текст пользователя из записи', extensions: { code } }] },
  };
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  (envDetector.detectEnvironment as any).mockReturnValue(PROD);
  refreshEnvironmentConfig();
  process.env.DIRECTUS_URL = 'http://directus.test';
});

/** Все строки, ушедшие в консоль любым уровнем. */
function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const push = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(push),
    vi.spyOn(console, 'warn').mockImplementation(push),
    vi.spyOn(console, 'error').mockImplementation(push),
  ];
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe('AI-65: коллекция и причина отказа — чистые функции', () => {
  it('коллекция берётся из адреса', () => {
    expect(collectionFromUrl('/items/campaign_content')).toBe('campaign_content');
    expect(collectionFromUrl('/items/campaign_content/42')).toBe('campaign_content');
    expect(collectionFromUrl('/items/user_campaigns?limit=1')).toBe('user_campaigns');
  });

  it('служебные разделы Directus тоже опознаются', () => {
    expect(collectionFromUrl('/users/me')).toBe('users');
    expect(collectionFromUrl('/auth/refresh')).toBe('auth');
    expect(collectionFromUrl('')).toBe('unknown');
  });

  it('причина берётся из машинного кода Directus, а не из текста', () => {
    expect(directusErrorCode(directusError(403, 'FORBIDDEN'))).toBe('FORBIDDEN');
    expect(directusErrorCode(directusError(400, 'RECORD_NOT_UNIQUE'))).toBe('RECORD_NOT_UNIQUE');
  });

  it('таймаут отличается от отказа', () => {
    expect(directusErrorCode({ code: 'ECONNABORTED' })).toBe('timeout');
    expect(directusErrorCode({ code: 'ETIMEDOUT' })).toBe('timeout');
  });

  it('когда кода нет — остаётся стабильный признак, а не текст ошибки', () => {
    expect(directusErrorCode({ response: { status: 502, data: {} } })).toBe('http_502');
    expect(directusErrorCode(new Error('что-то пошло не так'))).toBe('unknown');
  });

  it('состязание за блокировку не поднимает уровень: это штатный исход', () => {
    // Иначе в журнал вернётся ровно тот фон, от которого избавила AI-120.
    expect(levelForDirectusFailure(400, 'RECORD_NOT_UNIQUE')).toBe('debug');
    expect(levelForDirectusFailure(403, 'FORBIDDEN')).toBe('warn');
    expect(levelForDirectusFailure(500, 'http_500')).toBe('error');
    expect(levelForDirectusFailure(undefined, 'timeout')).toBe('error');
  });
});

describe('AI-65: отказ Directus оставляет ровно одну запись', () => {
  it('403 пишется предупреждением с коллекцией и причиной', async () => {
    vi.mocked(axios as any).mockRejectedValue(directusError(403, 'FORBIDDEN'));
    const cap = captureConsole();

    try {
      await expect(directusCrud.list('campaign_content', { authToken: 'user-token' })).rejects.toThrow();
    } finally {
      cap.restore();
    }

    const events = cap.lines.filter((l) => l.includes('directus.request_failed'));
    expect(events).toHaveLength(1);

    const line = JSON.parse(events[0]);
    expect(line.collection).toBe('campaign_content');
    expect(line.reason).toBe('FORBIDDEN');
    expect(line.status).toBe(403);
    expect(line.level).toBe('warn');
    expect(typeof line.durationMs).toBe('number');
  });

  it('в записи нет ни тела ответа, ни токена из текста ошибки', async () => {
    vi.mocked(axios as any).mockRejectedValue(directusError(403, 'FORBIDDEN'));
    const cap = captureConsole();

    try {
      await expect(directusCrud.list('campaign_content', { authToken: 'user-token' })).rejects.toThrow();
    } finally {
      cap.restore();
    }

    const all = cap.lines.join('\n');
    expect(all).not.toContain('SECRETTOKENVALUE1');
    expect(all).not.toContain('Текст пользователя из записи');
    expect(all).not.toContain('access_token');
  });

  it('ошибка уходит вызывающему коду ровно как раньше', async () => {
    const err = directusError(403, 'FORBIDDEN');
    vi.mocked(axios as any).mockRejectedValue(err);
    const cap = captureConsole();

    try {
      await expect(directusCrud.list('campaign_content', { authToken: 't' })).rejects.toBe(err);
    } finally {
      cap.restore();
    }
  });

  it('успешный запрос не пишет ничего', async () => {
    vi.mocked(axios as any).mockResolvedValue({ data: { data: [{ id: 1 }] } });
    const cap = captureConsole();

    try {
      await directusCrud.list('campaign_content', { authToken: 't' });
    } finally {
      cap.restore();
    }

    expect(cap.lines.filter((l) => l.includes('directus.request_'))).toHaveLength(0);
  });

  it('запрос без токена и без явной анонимности предупреждает заранее', async () => {
    vi.mocked(axios as any).mockResolvedValue({ data: { data: [] } });
    const cap = captureConsole();

    try {
      await directusCrud.list('autonomous_settings');
    } finally {
      cap.restore();
    }

    const events = cap.lines.filter((l) => l.includes('directus.request_anonymous'));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).collection).toBe('autonomous_settings');
  });
});

describe('AI-65: сторож исходника', () => {
  const src = readFileSync(join(__dirname, '..', 'services', 'directus-crud.ts'), 'utf8');

  it('тело ответа Directus больше не сериализуется в лог', () => {
    expect(src).not.toContain('JSON.stringify(error.response.data');
    expect(src).not.toMatch(/Response body/);
  });

  it('текст ошибки axios не печатается отдельной строкой', () => {
    expect(src).not.toMatch(/console\.(error|warn)\([^)]*error\.message/);
  });

  it('отказ записывается событием со стабильным именем', () => {
    expect(src).toMatch(/logEvent\(\s*'directus\.request_failed'/);
  });
});
