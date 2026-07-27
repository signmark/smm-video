import { directusApi } from '../directus';

export class CampaignAccessError extends Error {
  constructor(
    public readonly status: 404 | 503,
    public readonly code: 'CAMPAIGN_NOT_FOUND' | 'CAMPAIGN_ACCESS_UNAVAILABLE',
  ) {
    super(code);
  }
}

function resolveServiceToken(userToken: string): string {
  return process.env.DIRECTUS_STATIC_TOKEN
    || process.env.DIRECTUS_ADMIN_TOKEN
    || process.env.DIRECTUS_TOKEN
    || userToken;
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
    const response = await directusApi.get('/items/user_campaigns', {
      headers: { Authorization: `Bearer ${resolveServiceToken(userToken)}` },
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

  const serviceToken = resolveServiceToken(userToken);

  try {
    const response = await directusApi.get(`/items/user_campaigns/${encodeURIComponent(campaignId)}`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      params: { fields: ['*'] },
    });
    const campaign = response.data?.data;
    if (!campaign) throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');

    const ownerId = typeof campaign.user_id === 'object' ? campaign.user_id?.id : campaign.user_id;
    const creatorId = typeof campaign.user_created === 'object' ? campaign.user_created?.id : campaign.user_created;
    if (!isAdmin && ownerId !== userId && creatorId !== userId) {
      throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    }
    return campaign;
  } catch (error: any) {
    if (error instanceof CampaignAccessError) throw error;
    if (error?.response?.status === 403 || error?.response?.status === 404) {
      throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
    }
    throw new CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
  }
}
