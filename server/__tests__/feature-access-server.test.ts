/**
 * SM-36, серверная сторона. Главное здесь — «закрыто при сбое»: если почту
 * узнать не удалось, доступ обязан быть закрыт. Обратное поведение означало бы,
 * что падение Directus открывает платную возможность всем подряд.
 *
 * Отдельно сторожим саму проводку: маршрут анализа стиля должен спрашивать
 * разрешение ДО работы. Разрешающая функция, которую забыли вызвать, защищает
 * ровно ничего — а по коду это видно только чтением файла.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_STATIC_TOKEN = 'service-token';
  delete process.env.FEATURE_ACCESS_EMAILS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function loadHelper() {
  return await import('../services/feature-access-server');
}

function mockFetch(impl: any) {
  globalThis.fetch = vi.fn(impl) as any;
}

describe('userHasFeature', () => {
  it('владельцу возможность доступна', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ data: { email: 'signmark@gmail.com' } }) }));
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature('user-1', 'styleAnalysis')).resolves.toBe(true);
  });

  it('постороннему — нет', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ data: { email: 'someone@example.com' } }) }));
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature('user-2', 'styleAnalysis')).resolves.toBe(false);
  });

  it('почту спрашиваем у Directus, а не берём из токена', async () => {
    // В токене Directus почты может не быть вовсе: там идентификатор и роль.
    // Решение по пустой почте закрыло бы возможность самому владельцу.
    const calls: string[] = [];
    mockFetch(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ data: { email: 'signmark@gmail.com' } }) };
    });
    const { userHasFeature } = await loadHelper();
    await userHasFeature('user-1', 'styleAnalysis');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/users/user-1');
    expect(calls[0]).toContain('fields=email');
  });

  it('Directus недоступен — доступ закрыт, а не открыт', async () => {
    mockFetch(async () => { throw new Error('сеть недоступна'); });
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature('user-1', 'styleAnalysis')).resolves.toBe(false);
  });

  it('Directus ответил отказом — доступ закрыт', async () => {
    mockFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature('user-1', 'styleAnalysis')).resolves.toBe(false);
  });

  it('без пользователя Directus вообще не спрашиваем', async () => {
    const fetchSpy = vi.fn();
    mockFetch(fetchSpy);
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature(undefined, 'styleAnalysis')).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('список адресов читается из настроек окружения', async () => {
    process.env.FEATURE_ACCESS_EMAILS = 'second@gmail.com';
    mockFetch(async () => ({ ok: true, json: async () => ({ data: { email: 'second@gmail.com' } }) }));
    const { userHasFeature } = await loadHelper();
    await expect(userHasFeature('user-3', 'styleAnalysis')).resolves.toBe(true);
  });
});

describe('проводка маршрута анализа стиля', () => {
  const routes = readFileSync(resolve(__dirname, '../routes/campaigns.ts'), 'utf-8');

  it('маршрут спрашивает разрешение', () => {
    expect(routes).toContain("userHasFeature(userId, 'styleAnalysis')");
  });

  it('разрешение спрашивается ДО тяжёлой работы, а не после', () => {
    const routeStart = routes.indexOf("app.post('/api/campaigns/:campaignId/analyze-style'");
    expect(routeStart).toBeGreaterThan(-1);
    const guard = routes.indexOf('userHasFeature', routeStart);
    const work = routes.indexOf('MAX_CHARS', routeStart);
    expect(guard).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(work);
  });

  it('отказ приходит с понятной причиной и кодом 403', () => {
    const routeStart = routes.indexOf("app.post('/api/campaigns/:campaignId/analyze-style'");
    const chunk = routes.slice(routeStart, routeStart + 1400);
    expect(chunk).toContain('status(403)');
    expect(chunk).toMatch(/Профессиональный/);
  });
});

describe('в интерфейсе не осталось правила доступа', () => {
  it('страница кампании больше не сравнивает почту со строкой', () => {
    const page = readFileSync(
      resolve(__dirname, '../../client/src/pages/campaigns/[id].tsx'),
      'utf-8',
    );
    // Ровно тот случай, из-за которого владелец не видел блок под вторым адресом.
    expect(page).not.toContain("userProfile?.email === 'signmark@gmail.com'");
    expect(page).toContain('userProfile?.features?.styleAnalysis');
  });

  it('страница контента тоже не сравнивает почту', () => {
    // Мест было ДВА, и второе легко пропустить: правило разъехалось бы молча.
    const page = readFileSync(
      resolve(__dirname, '../../client/src/pages/content/index.tsx'),
      'utf-8',
    );
    expect(page).not.toContain("userProfile?.email === 'signmark@gmail.com'");
    expect(page).toContain('userProfile?.features?.styleAnalysis');
  });

  it('блок стиля показывается только при разрешении', () => {
    const page = readFileSync(
      resolve(__dirname, '../../client/src/pages/campaigns/[id].tsx'),
      'utf-8',
    );
    expect(page).toContain('isStyleFeatureEnabled &&');
  });
});
