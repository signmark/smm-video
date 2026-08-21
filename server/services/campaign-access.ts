import { directusApi } from '../directus';
import { adminTokenManager } from './admin-token-manager';
import { enrichRequestContext } from '../utils/request-context';

export class CampaignAccessError extends Error {
  constructor(
    public readonly status: 404 | 503,
    public readonly code: 'CAMPAIGN_NOT_FOUND' | 'CAMPAIGN_ACCESS_UNAVAILABLE',
  ) {
    super(code);
  }
}

// Служебный токен для чтения кампании через код-проверку владельца (нужен,
// т.к. админ должен видеть чужие кампании, а у campaign_content_sources/keywords
// нет своего user_id). Через adminTokenManager: он валидирует статический токен
// и при протухании входит по email/паролю. Раньше здесь брался сырой
// process.env.DIRECTUS_STATIC_TOKEN — когда он протух, чтение кампании падало
// 401 → 503 «Кампания не найдена или нет прав», хотя кампания своя.
async function resolveServiceToken(userToken: string): Promise<string> {
  const adminToken = await adminTokenManager.getAdminToken();
  return adminToken || userToken;
}

/**
 * ID всех кампаний, к которым у пользователя есть доступ (владелец или создатель).
 *
 * Нужен там, где коллекция привязана к арендатору ТОЛЬКО через campaign_id и
 * своей колонки user_id у неё либо нет (campaign_keywords), либо она не
 * заполняется при создании (campaign_content_sources — ни один из путей записи
 * её не пишет). Фильтровать такие выборки по user_id нельзя: у живых строк там
 * NULL, и список у владельца опустеет. Поэтому принадлежность считаем через
 * user_campaigns.
 *
 * Fail-closed: при недоступном Directus бросаем 503, а не отдаём выборку без
 * фильтра — иначе ошибка в БД превращается в утечку.
 */
export async function listAccessibleCampaignIds(
  userId: string | undefined,
  userToken: string,
): Promise<string[]> {
  if (!userId) return [];

  try {
    // UI-поток: читаем токеном пользователя. RBAC user_campaigns
    // (read: user_id = $CURRENT_USER) сам ограничивает выборку своими
    // кампаниями — статический токен здесь не нужен и не используется.
    const response = await directusApi.get('/items/user_campaigns', {
      headers: { Authorization: `Bearer ${userToken}` },
      params: {
        // Только user_id. Фильтр по user_created живой Directus отвергает с 403
        // («no permission to access field user_created ... or it does not exist»):
        // в SQL-схеме колонка есть, но у роли этого поля нет. Через catch ниже это
        // превращалось в 503 на каждом запросе без campaignId — то есть эндпоинт
        // ложился для всех неадминов. Канонический список кампаний
        // (GET /api/campaigns) фильтрует ровно так же, только по user_id.
        filter: JSON.stringify({ user_id: { _eq: userId } }),
        fields: ['id'],
        limit: -1,
      },
    });

    const items = response.data?.data;
    if (!Array.isArray(items)) return [];
    return items.map((item: any) => item?.id).filter((id: any) => typeof id === 'string' && id);
  } catch (error: any) {
    throw new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
  }
}

export async function authorizeCampaignAccess(
  campaignId: string,
  userId: string | undefined,
  userToken: string,
  isAdmin: boolean,
): Promise<any> {
  if (!userId) throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');

  // UI-поток: сначала читаем кампанию ТОКЕНОМ ПОЛЬЗОВАТЕЛЯ. RBAC user_campaigns
  // (read: user_id = $CURRENT_USER) отдаёт кампанию только владельцу, чужую —
  // 403/404. Изоляцию обеспечивает Directus, без обращения к статическому токену.
  try {
    const response = await directusApi.get(`/items/user_campaigns/${encodeURIComponent(campaignId)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      params: { fields: ['*'] },
    });
    const campaign = response.data?.data;
    if (campaign) {
      // RBAC уже должен был отсечь чужую кампанию, но проверяем владельца и в
      // коде — defense-in-depth: если RBAC когда-то ослабят или токен окажется
      // шире ожидаемого, изоляция всё равно устоит.
      const ownerId = typeof campaign.user_id === 'object' ? campaign.user_id?.id : campaign.user_id;
      const creatorId = typeof campaign.user_created === 'object' ? campaign.user_created?.id : campaign.user_created;
      if (isAdmin || ownerId === userId || creatorId === userId) {
        // AI-65: кампания в журнал только ПОСЛЕ подтверждения доступа (чужой ввод из URL
        // не должен попадать в лог, пока authorizeCampaignAccess не убедился, что кампания есть и доступ есть).
        enrichRequestContext({ campaignId });
        return campaign;
      }
      throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    }
  } catch (error: any) {
    if (error instanceof CampaignAccessError) throw error;
    const st = error?.response?.status;
    // 401 = проблема пользовательской сессии, пусть её разбирает вызывающий хендлер.
    if (st === 401) throw new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
    // 403/404 своим токеном — не владелец. Для обычного пользователя это отказ.
    if ((st === 403 || st === 404) && !isAdmin) {
      throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    }
    if (st !== 403 && st !== 404) throw new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
    // isAdmin + 403/404 → падаем в служебное чтение ниже
  }

  if (!isAdmin) throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');

  // Только для админа (не UI-пользователь): просмотр чужой кампании служебным
  // токеном. adminTokenManager валидирует статический токен / входит логином.
  try {
    const serviceToken = await resolveServiceToken(userToken);
    const response = await directusApi.get(`/items/user_campaigns/${encodeURIComponent(campaignId)}`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      params: { fields: ['*'] },
    });
    const campaign = response.data?.data;
    if (!campaign) throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    // AI-65: admin-путь тоже подтверждает доступ — тогда кампания попадает в журнал.
    enrichRequestContext({ campaignId });
    return campaign;
  } catch (error: any) {
    if (error instanceof CampaignAccessError) throw error;
    if (error?.response?.status === 403 || error?.response?.status === 404) {
      throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    }
    throw new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
  }
}
