/**
 * Проверка, что соцплатформа реально сконфигурирована в кампании
 * (есть валидные токены/идентификаторы). Используется при планировании,
 * чтобы не ставить в очередь публикацию на платформу без настроек.
 */

export type SocialPlatformKey =
  | 'telegram'
  | 'vk'
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'threads'
  | 'tiktok';

const nonEmpty = (v: any) => typeof v === 'string' && v.trim().length > 0;

// Проверяет поле в camelCase и snake_case одновременно
const field = (settings: any, ...keys: string[]): boolean => {
  for (const key of keys) {
    if (nonEmpty(settings[key])) return true;
    // snake_case вариант
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (snake !== key && nonEmpty(settings[snake])) return true;
  }
  return false;
};

export function isPlatformConfigured(
  platform: string,
  settings: any
): boolean {
  if (!settings || typeof settings !== 'object') return false;

  switch (platform) {
    case 'telegram':
      return field(settings, 'botToken', 'token')
        && field(settings, 'chatId', 'channelId');
    case 'vk':
      return field(settings, 'token', 'accessToken')
        && field(settings, 'groupId');
    case 'instagram':
      return field(settings, 'accessToken', 'token')
        && field(settings, 'businessAccountId', 'instagramAccountId', 'pageId');
    case 'facebook':
      return field(settings, 'accessToken', 'token')
        && field(settings, 'pageId');
    case 'youtube':
      return field(settings, 'accessToken', 'refreshToken', 'token');
    case 'threads':
      return field(settings, 'accessToken')
        && field(settings, 'userId', 'threadsUserId');
    case 'tiktok':
      return field(settings, 'accessToken', 'token');
    default:
      return false;
  }
}

/**
 * Машинно-читаемые коды причин, по которым платформа исключена из планирования.
 * Хранятся в social_platforms[platform].errorCode и попадают в UI/логи.
 */
export const PLATFORM_ERROR_CODES = {
  NOT_CONFIGURED: 'PLATFORM_NOT_CONFIGURED',
  MISSING_CREDENTIALS: 'PLATFORM_MISSING_CREDENTIALS',
} as const;

export type PlatformErrorCode =
  (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];

export interface SkippedPlatform {
  platform: string;
  code: PlatformErrorCode;
  reason: string;
}

/**
 * Возвращает { configured, skipped }, где skipped — список платформ,
 * которые юзер выбрал, но которые в кампании не настроены.
 */
export function filterConfiguredPlatforms(
  socialMediaSettings: Record<string, any> | null | undefined,
  requestedPlatforms: string[]
): { configured: string[]; skipped: SkippedPlatform[] } {
  const configured: string[] = [];
  const skipped: SkippedPlatform[] = [];

  for (const platform of requestedPlatforms) {
    const settings = socialMediaSettings?.[platform];
    if (isPlatformConfigured(platform, settings)) {
      configured.push(platform);
    } else if (!settings || (typeof settings === 'object' && Object.keys(settings).length === 0)) {
      skipped.push({
        platform,
        code: PLATFORM_ERROR_CODES.NOT_CONFIGURED,
        reason: `[${PLATFORM_ERROR_CODES.NOT_CONFIGURED}] ${platform}: не настроен для кампании`,
      });
    } else {
      skipped.push({
        platform,
        code: PLATFORM_ERROR_CODES.MISSING_CREDENTIALS,
        reason: `[${PLATFORM_ERROR_CODES.MISSING_CREDENTIALS}] ${platform}: не хватает обязательных настроек (токен/идентификатор)`,
      });
    }
  }

  return { configured, skipped };
}
