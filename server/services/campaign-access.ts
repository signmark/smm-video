import { directusApi } from '../directus';

export class CampaignAccessError extends Error {
  constructor(
    public readonly status: 404 | 503,
    public readonly code: 'CAMPAIGN_NOT_FOUND' | 'CAMPAIGN_ACCESS_UNAVAILABLE',
  ) {
    super(code);
  }
}

export async function authorizeCampaignAccess(
  campaignId: string,
  userId: string | undefined,
  userToken: string,
  isAdmin: boolean,
): Promise<any> {
  if (!userId) throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');

  const serviceToken = process.env.DIRECTUS_STATIC_TOKEN
    || process.env.DIRECTUS_ADMIN_TOKEN
    || process.env.DIRECTUS_TOKEN
    || userToken;

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
