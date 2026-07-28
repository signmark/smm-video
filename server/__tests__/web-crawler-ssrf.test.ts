/**
 * SSRF-защита краулера живёт ВНУТРИ агента, а не в роуте.
 *
 * Находки ревью: роут проверял URL, но реальный переход резолвил адрес заново и шёл по
 * редиректам; `credentials.loginUrl` не проверялся вовсе; прямые вызовы
 * `webCrawlerAgent` (ai-service, autonomous-ai, campaigns) защиты не получали совсем.
 *
 * Браузерный обход выключен: Chromium резолвит имена сам, поэтому наша проверка на него
 * не распространяется — ни на навигацию, ни на подресурсы, ни на редиректы.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger', () => {
  const l: any = vi.fn();
  l.info = vi.fn(); l.warn = vi.fn(); l.error = vi.fn(); l.debug = vi.fn();
  return { log: l, default: l, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

/** Карта DNS для теста: имя → адрес. */
const DNS: Record<string, string> = {
  'good.example.com': '93.184.216.34',
  'evil.example.com': '127.0.0.1',
  'metadata.example.com': '169.254.169.254',
};

vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(async (host: string) => {
        const addr = DNS[host];
        if (!addr) throw new Error('ENOTFOUND');
        return [{ address: addr, family: 4 }];
      }),
    },
  },
}));

const safeGet = vi.fn();
vi.mock('../utils/safe-http', () => ({
  safeGet: (...a: any[]) => safeGet(...a),
  BlockedUrlError: class BlockedUrlError extends Error {},
}));

let agent: any;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.WEB_CRAWLER_BROWSER_ENABLED;
  // Успехом считается текст длиннее 50 символов — отдаём осмысленную страницу.
  safeGet.mockResolvedValue({
    status: 200,
    headers: {},
    data: '<html><head><title>Тест</title></head><body>'
      + 'Достаточно длинный текст страницы, чтобы краулер счёл разбор успешным.'
      + '</body></html>',
  });
  agent = (await import('../services/web-crawler-agent')).webCrawlerAgent;
});

afterEach(() => {
  delete process.env.WEB_CRAWLER_BROWSER_ENABLED;
});

describe('основной URL', () => {
  it('домен, резолвящийся в loopback, отклоняется до всякого запроса', async () => {
    const res = await agent.crawlSite({ url: 'http://evil.example.com/' });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/заблокированный URL/);
    expect(safeGet).not.toHaveBeenCalled();
  });

  it('домен, резолвящийся в metadata-адрес, отклоняется', async () => {
    const res = await agent.crawlSite({ url: 'http://metadata.example.com/latest/meta-data/' });

    expect(res.success).toBe(false);
    expect(safeGet).not.toHaveBeenCalled();
  });

  it('литеральный приватный адрес отклоняется', async () => {
    const res = await agent.crawlSite({ url: 'http://169.254.169.254/latest/meta-data/' });

    expect(res.success).toBe(false);
    expect(safeGet).not.toHaveBeenCalled();
  });

  it('нехттп-протокол отклоняется', async () => {
    const res = await agent.crawlSite({ url: 'file:///etc/passwd' });

    expect(res.success).toBe(false);
    expect(safeGet).not.toHaveBeenCalled();
  });

  it('публичный домен проходит и идёт через safeGet, а не через голый axios', async () => {
    const res = await agent.crawlSite({ url: 'http://good.example.com/page' });

    expect(res.success).toBe(true);
    expect(safeGet).toHaveBeenCalledTimes(1);
    expect(safeGet.mock.calls[0][0]).toBe('http://good.example.com/page');
  });
});

describe('credentials.loginUrl', () => {
  it('loginUrl на metadata-сервис отклоняется, даже если основной URL публичный', async () => {
    const res = await agent.crawlSite({
      url: 'http://good.example.com/',
      needsAuth: true,
      credentials: { loginUrl: 'http://169.254.169.254/latest/meta-data/', username: 'u', password: 'p' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/loginUrl/);
    expect(safeGet).not.toHaveBeenCalled();
  });

  it('loginUrl, резолвящийся в loopback, отклоняется', async () => {
    const res = await agent.crawlSite({
      url: 'http://good.example.com/',
      needsAuth: true,
      credentials: { loginUrl: 'http://evil.example.com/login', username: 'u', password: 'p' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/loginUrl/);
  });

  it('публичный loginUrl проходит', async () => {
    const res = await agent.crawlSite({
      url: 'http://good.example.com/',
      needsAuth: true,
      credentials: { loginUrl: 'http://good.example.com/login', username: 'u', password: 'p' },
    });

    expect(res.success).toBe(true);
  });
});

describe('браузерный обход', () => {
  it('по умолчанию выключен — идёт безопасный HTTP-путь, Puppeteer не поднимается', async () => {
    const res = await agent.crawlSite({ url: 'http://good.example.com/' });

    expect(res.success).toBe(true);
    // Признак безопасного пути: запрос ушёл через safeGet
    expect(safeGet).toHaveBeenCalled();
  });
});

describe('intelligentCrawl получает ту же защиту', () => {
  it('приватный URL отклоняется и через intelligentCrawl', async () => {
    // intelligentCrawl не возвращает результат, а бросает — важно, что запрос не ушёл.
    await expect(agent.intelligentCrawl('http://evil.example.com/')).rejects.toThrow(/заблокированный URL/);
    expect(safeGet).not.toHaveBeenCalled();
  });
});
