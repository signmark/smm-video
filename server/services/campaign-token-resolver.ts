import axios from 'axios';
import { authorizeCampaignAccess } from './campaign-access';

/**
 * Единая точка резолва OAuth-токенов платформ из настроек кампании.
 *
 * Контракт (docs/prompts/hermes-social-ui-token-removal-2026-07-24.md):
 * токены вырезаются из всех API-ответов (sanitizeOAuthSecrets) и в браузер
 * не попадают. Когда серверу нужен токен платформы, он достаёт его из
 * Directus по campaignId — эти функции инкапсулируют каскады fallback'ов.
 * Результат НИКОГДА не возвращать клиенту.
 */

export type TokenPlatform = 'instagram' | 'facebook' | 'vk' | 'threads';

/**
 * Каскад выбора токена из уже загруженных social_media_settings.
 * facebook намеренно начинается с Instagram-токенов: флоу «Взять из ИГ» —
 * пользовательский Meta-токен один на обе платформы.
 */
export function pickPlatformToken(
  socialMediaSettings: Record<string, any> | null | undefined,
  platform: TokenPlatform,
): string | undefined {
  const sms = socialMediaSettings || {};
  const ig = sms.instagram || {};
  switch (platform) {
    case 'instagram':
      return ig.longLivedToken || ig.accessToken || ig.token || undefined;
    case 'facebook': {
      const fb = sms.facebook || {};
      return ig.longLivedToken || ig.accessToken || ig.token || fb.userToken || fb.token || undefined;
    }
    case 'vk':
      return sms.vk?.token || undefined;
    case 'threads':
      return sms.threads?.accessToken || undefined;
  }
}

export interface ResolveTokenOptions {
  /**
   * Если передан — доступ к кампании проверяется через authorizeCampaignAccess
   * (бросает CampaignAccessError). Без user — чтение admin-токеном без проверки
   * владения: только для роутов, где доступ уже авторизован ранее.
   */
  user?: { id?: string; is_smm_admin?: boolean };
}

/**
 * Читает social_media_settings кампании admin-токеном Directus.
 * С opts.user дополнительно проверяет права доступа к кампании.
 */
export async function getCampaignSocialSettings(
  campaignId: string,
  opts: ResolveTokenOptions = {},
): Promise<Record<string, any>> {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
  if (!adminToken || !process.env.DIRECTUS_URL) {
    throw new Error('Directus admin token / URL не настроены (DIRECTUS_STATIC_TOKEN, DIRECTUS_URL)');
  }

  if (opts.user) {
    const campaign = await authorizeCampaignAccess(
      campaignId,
      opts.user.id,
      adminToken,
      opts.user.is_smm_admin === true,
    );
    return campaign.social_media_settings || {};
  }

  const resp = await axios.get(
    `${process.env.DIRECTUS_URL}/items/user_campaigns/${encodeURIComponent(campaignId)}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  return resp.data.data?.social_media_settings || {};
}

/** Загружает настройки кампании и применяет каскад платформы. */
export async function resolvePlatformToken(
  campaignId: string,
  platform: TokenPlatform,
  opts: ResolveTokenOptions = {},
): Promise<string | undefined> {
  const sms = await getCampaignSocialSettings(campaignId, opts);
  return pickPlatformToken(sms, platform);
}
