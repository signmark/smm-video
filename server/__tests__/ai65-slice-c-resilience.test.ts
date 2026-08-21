/**
 * AI-65 срез C (task #67): наблюдение не должно ронять внешний вызов.
 *
 * Поведенческий тест: подменяем `log.external` функцией, которая БРОСАЕТ
 * исключение на каждом вызове, и проверяем, что:
 *   1) apify.runInstagramScraper всё равно возвращает id прогона;
 *   2) apify.getRunStatus всё равно возвращает статус;
 *   3) вызов действительно прошёл к сервису (axios дёрнули);
 *   4) если axios сам бросил, обёрнутый метод всё равно пробрасывает ошибку
 *      дальше — то есть внешний сбой не маскируется журналированием;
 *   5) deepseek и claude также устойчивы к падающему log.external.
 *
 * Это закрывает регрессию «внутренний try/catch вокруг log.external
 * проглотил throw из самого log.external». Краснел бы на неполном моке
 * без оборонительной обёртки; source-guard (наличие try/catch) этого
 * доказать не может.
 *
 * Тест работает потому, что мы не импортируем из logger напрямую — обёрнутый
 * сервис вызывает `log.external(...)`, и если `log.external` кидает,
 * это должно быть проглочено внутренним try/catch в проде-коде.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let externalCallCount = 0;
vi.mock('../utils/logger', async (importOriginal) => {
  const mod: any = await importOriginal();
  const log = Object.assign(vi.fn(), {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    // ЛОВИМ ВСЕ ВЫЗОВЫ log.external: и накидываем счётчик, и бросаем,
    // чтобы проверить, что прод-код не падает.
    external: vi.fn(() => { externalCallCount++; throw new Error('logger down'); }),
  });
  return {
    ...mod,
    log,
    default: { log, info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn(async () => ({
      status: 201,
      data: { id: 'run-xyz', actId: 'instagram-post-scraper', status: 'RUNNING' },
    })),
    get: vi.fn(async () => ({
      status: 200,
      data: { id: 'run-xyz', status: 'SUCCEEDED' },
    })),
    create: vi.fn(() => ({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      post: vi.fn(), get: vi.fn(), patch: vi.fn(),
    })),
    isAxiosError: vi.fn((e: any) => !!e?.isAxiosError),
  },
}));

vi.mock('./api-keys', () => ({
  apiKeyService: {
    getApiKey: vi.fn(async () => 'fake-key'),
  },
}));

import axios from 'axios';
import { ApifyService } from '../services/apify';

const svc = new ApifyService();
(svc as any).apiKey = 'fake-key';

describe('AI-65 срез C: внешний вызов переживает падающее журналирование (behavioral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalCallCount = 0;
  });

  it('apify.runInstagramScraper: log.external бросает, но id прогона возвращается', async () => {
    const id = await svc.runInstagramScraper('someuser');
    expect(id).toBe('run-xyz');
    expect(externalCallCount).toBeGreaterThan(0);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('apify.getRunStatus: log.external бросает, но статус возвращается', async () => {
    const status = await svc.getRunStatus('run-xyz');
    expect(status).toBe('SUCCEEDED');
    expect(externalCallCount).toBeGreaterThan(0);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('apify: axios бросает — исходная ошибка пробрасывается, log.external тоже падает (не маскируется)', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(Object.assign(new Error('network reset'), {
      isAxiosError: true,
      code: 'ECONNRESET',
    }));
    await expect(svc.runInstagramScraper('user')).rejects.toThrow(/network reset/);
    expect(externalCallCount).toBeGreaterThan(0);
  });

  it('deepseek.generateTextFromMessages: log.external бросает, текст возвращается', async () => {
    const { DeepSeekService } = await import('../services/deepseek');
    const ds = new DeepSeekService({ apiKey: 'fake-deepseek-key' });
    vi.mocked(axios.post).mockImplementationOnce(async () => ({
      status: 200,
      data: { choices: [{ message: { content: 'привет мир' } }] },
    } as any));
    const text = await ds.generateTextFromMessages([{ role: 'user', content: 'hi' }]);
    expect(text).toBe('привет мир');
    expect(externalCallCount).toBeGreaterThan(0);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('claude.makeRequest: log.external бросает, ответ возвращается', async () => {
    const { ClaudeService } = await import('../services/claude');
    const cs = new ClaudeService('fake-claude-key');
    vi.mocked(axios.post).mockImplementationOnce(async () => ({
      status: 200,
      data: { content: [{ type: 'text', text: 'hello' }] },
    } as any));
    const result = await (cs as any).makeRequest({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content[0].text).toBe('hello');
    expect(externalCallCount).toBeGreaterThan(0);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('deepseek: axios бросает — исходная ошибка пробрасывается, log.external тоже падает', async () => {
    const { DeepSeekService } = await import('../services/deepseek');
    const ds = new DeepSeekService({ apiKey: 'fake-deepseek-key' });
    vi.mocked(axios.post).mockRejectedValueOnce(Object.assign(new Error('api timeout'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
    }));
    await expect(ds.generateTextFromMessages([{ role: 'user', content: 'hi' }])).rejects.toThrow(/api timeout/);
    expect(externalCallCount).toBeGreaterThan(0);
  });
});