/**
 * listAccessibleCampaignIds — база для выборок «всё моё» там, где строка
 * привязана к арендатору только через campaign_id.
 *
 * Почему не user_id: у campaign_keywords такой колонки нет вовсе, а у
 * campaign_content_sources она есть в схеме, но НЕ заполняется ни одним путём
 * создания (роут POST /api/sources, trend-collector, telegram-channels-routes —
 * ни один её не пишет). Фильтр по user_id опустошил бы списки на проде.
 *
 * Отдельно важно fail-closed: при недоступном Directus функция обязана бросить,
 * а не вернуть пустой/полный набор, иначе сбой БД превращается в утечку.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { directusGet } = vi.hoisted(() => ({ directusGet: vi.fn() }));

vi.mock('../directus', () => ({
  directusApi: { get: directusGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { listAccessibleCampaignIds, CampaignAccessError } from '../services/campaign-access';

const USER = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_STATIC_TOKEN = 'service-token';
});

describe('listAccessibleCampaignIds', () => {
  it('спрашивает у Directus кампании пользователя фильтром только по user_id', async () => {
    directusGet.mockResolvedValueOnce({ data: { data: [{ id: 'c1' }, { id: 'c2' }] } });

    const ids = await listAccessibleCampaignIds(USER, 'user-token');

    expect(ids).toEqual(['c1', 'c2']);
    const [path, config] = directusGet.mock.calls[0];
    expect(path).toBe('/items/user_campaigns');
    // Именно так, и никаких _or с user_created: живой Directus отвергает фильтр по
    // этому полю с 403, что через catch превращалось в 503 для всех неадминов.
    // Мок такое поймать не может — регрессию нашли только прогоном по проду.
    // Канонический GET /api/campaigns фильтрует так же.
    expect(JSON.parse(config.params.filter)).toEqual({ user_id: { _eq: USER } });
    // UI-поток ходит ТОКЕНОМ ПОЛЬЗОВАТЕЛЯ, а не статическим: изоляцию обеспечивает
    // RBAC (user_campaigns read: user_id = $CURRENT_USER), и обычный пользователь
    // не должен дёргать статический токен. Фильтр по user_id оставлен как явная
    // подстраховка поверх RBAC.
    expect(config.headers.Authorization).toBe('Bearer user-token');
  });

  it('без userId возвращает пустой список и в Directus не ходит', async () => {
    const ids = await listAccessibleCampaignIds(undefined, 'user-token');

    expect(ids).toEqual([]);
    expect(directusGet).not.toHaveBeenCalled();
  });

  it('у пользователя без кампаний — пустой список', async () => {
    directusGet.mockResolvedValueOnce({ data: { data: [] } });

    expect(await listAccessibleCampaignIds(USER, 'user-token')).toEqual([]);
  });

  it('ошибка Directus → 503, а не «доступ ко всему»', async () => {
    directusGet.mockRejectedValue(new Error('boom'));

    const error = await listAccessibleCampaignIds(USER, 'user-token').catch((e: any) => e);
    expect(error).toBeInstanceOf(CampaignAccessError);
    expect(error.status).toBe(503);
    expect(error.code).toBe('CAMPAIGN_ACCESS_UNAVAILABLE');
  });

  it('мусор в ответе не превращается в id', async () => {
    directusGet.mockResolvedValueOnce({ data: { data: [{ id: 'c1' }, { id: null }, {}, { id: 42 }] } });

    expect(await listAccessibleCampaignIds(USER, 'user-token')).toEqual(['c1']);
  });
});
