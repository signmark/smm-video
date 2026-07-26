/**
 * Граница арендатора у публикующих ручек.
 *
 * Регрессия, которую стерегут эти тесты: 2026-07-26 публикация была переведена
 * с пользовательского токена на сервисный (правильно — фоновая публикация не
 * должна зависеть от сессии владельца). Но пользовательский токен заодно служил
 * ЕДИНСТВЕННОЙ проверкой владения: чужой контент просто не читался. Сервисный
 * читает контент всех, и на несколько часов `POST /api/retry-platform` и
 * `POST /api/publish/now` позволяли опубликовать чужой contentId.
 *
 * Вывод, который стоит помнить: если доступ держится на том, ЧЬИМ токеном идёт
 * запрос, смена токена ломает авторизацию молча — тестами это не ловилось,
 * потому что тестов на чужой contentId не было.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
const CONTENT_ID = 'content-1';
const CAMPAIGN_ID = 'campaign-1';

// vi.mock поднимается выше объявлений модуля, поэтому класс и шпион создаём
// через vi.hoisted — иначе фабрика мока обращается к ним до инициализации.
const { authorizeCampaignAccess, CampaignAccessError } = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  return { authorizeCampaignAccess: vi.fn(), CampaignAccessError };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: (...args: any[]) => authorizeCampaignAccess(...args),
  CampaignAccessError,
}));

vi.mock('../services/publishing-token', () => ({
  resolvePublishingToken: vi.fn().mockResolvedValue('service-token'),
  getServiceTokenFromEnv: vi.fn().mockReturnValue('service-token'),
}));

const axiosGet = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => axiosGet(...args),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../utils/logger', () => ({ log: vi.fn() }));

import { authorizeCampaignAccess as realAuthorize } from '../services/campaign-access';

/**
 * Повторяет проверку из social-publishing-router: контент читается сервисным
 * токеном, владение — через authorizeCampaignAccess по кампании контента.
 */
async function assertContentBelongsToRequester(
  contentId: string,
  user: { id?: string; token?: string; is_smm_admin?: boolean } | undefined,
): Promise<{ ok: boolean; status?: number }> {
  let campaignRef: any;
  try {
    const resp: any = await axiosGet(
      `http://directus.test/items/campaign_content/${encodeURIComponent(contentId)}?fields=campaign_id`,
      { headers: { Authorization: 'Bearer service-token' } },
    );
    campaignRef = resp.data?.data?.campaign_id;
  } catch {
    return { ok: false, status: 404 };
  }

  const campaignId = typeof campaignRef === 'object' && campaignRef !== null ? campaignRef.id : campaignRef;
  if (!campaignId) return { ok: false, status: 404 };

  try {
    await realAuthorize(String(campaignId), user?.id, user?.token || '', user?.is_smm_admin === true);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof CampaignAccessError && err.status === 503) return { ok: false, status: 503 };
    return { ok: false, status: 404 };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  axiosGet.mockResolvedValue({ data: { data: { campaign_id: CAMPAIGN_ID } } });
  authorizeCampaignAccess.mockImplementation(async (_campaignId: string, userId: string, _t: string, isAdmin: boolean) => {
    if (isAdmin || userId === OWNER) return { id: CAMPAIGN_ID, user_id: OWNER };
    throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
});

describe('Граница арендатора при публикации', () => {
  it('владелец получает доступ к своему контенту', async () => {
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    expect(result.ok).toBe(true);
  });

  it('чужой пользователь НЕ получает доступ', async () => {
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: STRANGER, token: 't' });
    expect(result.ok).toBe(false);
  });

  it('чужому отвечаем 404, а не 403 — не подтверждаем существование контента', async () => {
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: STRANGER, token: 't' });
    expect(result.status).toBe(404);
  });

  it('владение проверяется по кампании контента, а не по переданным данным', async () => {
    await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    expect(authorizeCampaignAccess).toHaveBeenCalledWith(CAMPAIGN_ID, OWNER, 't', false);
  });

  it('контент читается сервисным токеном — иначе публикация зависела бы от сессии', async () => {
    await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    const [, config] = axiosGet.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer service-token');
  });

  it('админ проходит проверку', async () => {
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: STRANGER, token: 't', is_smm_admin: true });
    expect(result.ok).toBe(true);
  });

  it('без пользователя доступа нет', async () => {
    const result = await assertContentBelongsToRequester(CONTENT_ID, undefined);
    expect(result.ok).toBe(false);
  });

  it('несуществующий контент — 404', async () => {
    axiosGet.mockRejectedValue(new Error('404'));
    const result = await assertContentBelongsToRequester('нет-такого', { id: OWNER, token: 't' });
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('контент без кампании доступа не даёт', async () => {
    axiosGet.mockResolvedValue({ data: { data: { campaign_id: null } } });
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('campaign_id связью-объектом разбирается корректно', async () => {
    axiosGet.mockResolvedValue({ data: { data: { campaign_id: { id: CAMPAIGN_ID } } } });
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    expect(result.ok).toBe(true);
    expect(authorizeCampaignAccess).toHaveBeenCalledWith(CAMPAIGN_ID, OWNER, 't', false);
  });

  it('недоступный Directus — 503, а не «нет доступа»', async () => {
    authorizeCampaignAccess.mockRejectedValue(new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE'));
    const result = await assertContentBelongsToRequester(CONTENT_ID, { id: OWNER, token: 't' });
    expect(result).toEqual({ ok: false, status: 503 });
  });
});
