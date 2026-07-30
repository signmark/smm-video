/**
 * Ручная загрузка сообществ VK: POST /api/vk/groups.
 *
 * Регрессия ревью 2026-07-29: запрос уходил с Content-Type, но БЕЗ Authorization.
 * Сессия приложения живёт в localStorage, поэтому глобальный гейт /api отвечал
 * 401 до обработчика — «загрузить группы по токену» не работало вовсе.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchVkGroupsByManualToken } from '../vk-groups-request';

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, groups: [] }) }));
const stored = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  // Тесты гоняются в node-окружении — localStorage подменяется, как и в
  // остальных клиентских тестах (см. refreshAuth.test.ts).
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  stored.set('auth_token', 'session-jwt');
});

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  fetchMock.mockClear();
});

describe('fetchVkGroupsByManualToken', () => {
  it('шлёт POST с токеном VK в теле и Bearer-сессией в заголовке', async () => {
    await fetchVkGroupsByManualToken('vk2.a.manual-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('/api/vk/groups');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ accessToken: 'vk2.a.manual-token' });

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    // Без Authorization глобальный /api гейт отдаёт 401 — заголовок обязателен.
    expect(headers['Authorization']).toBe('Bearer session-jwt');
  });

  it('токен VK не попадает в URL/query-строку', async () => {
    await fetchVkGroupsByManualToken('vk2.a.manual-token');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain('manual-token');
    expect(url).not.toContain('?');
  });
});
