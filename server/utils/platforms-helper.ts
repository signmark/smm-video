/**
 * Утилиты для работы с social_platforms
 */

export interface PlatformData {
  platform: string;
  status: string;
  postId?: string;
  postUrl?: string;
  publishedAt?: string;
  type?: string;
  [key: string]: any;
}

export type SocialPlatforms = Record<string, PlatformData>;

/**
 * Нормализует platforms из массива или объекта в объект
 * Массив преобразуется в объект с ключами по имени платформы
 */
export function normalizePlatforms(platforms: any): SocialPlatforms {
  if (!platforms) {
    return {};
  }

  // Если уже объект
  if (!Array.isArray(platforms) && typeof platforms === 'object') {
    // Очищаем от числовых ключей (мусор от предыдущих ошибок)
    const cleaned: SocialPlatforms = {};
    for (const key of Object.keys(platforms)) {
      if (isNaN(Number(key))) {
        cleaned[key] = platforms[key];
      }
    }
    return cleaned;
  }

  // Если массив - преобразуем в объект
  if (Array.isArray(platforms)) {
    const result: SocialPlatforms = {};
    for (const item of platforms) {
      if (item && typeof item === 'object' && item.platform) {
        result[item.platform] = item;
      }
    }
    return result;
  }

  return {};
}

/**
 * Создает pending статусы для платформ
 */
export function createPendingStatuses(
  platformNames: string[],
  isScheduled: boolean = false
): SocialPlatforms {
  const result: SocialPlatforms = {};
  const status = isScheduled ? 'scheduled' : 'pending';

  for (const platform of platformNames) {
    result[platform] = {
      platform,
      status,
      publishedAt: new Date().toISOString()
    };
  }

  return result;
}

/**
 * Обновляет данные платформы в существующем объекте platforms
 */
export function updatePlatformData(
  currentPlatforms: SocialPlatforms,
  platform: string,
  data: Partial<PlatformData>
): SocialPlatforms {
  const normalized = normalizePlatforms(currentPlatforms);

  return {
    ...normalized,
    [platform]: {
      ...normalized[platform],
      ...data,
      platform
    }
  };
}

/**
 * Проверяет, является ли platforms валидным объектом
 */
export function isValidPlatformsObject(platforms: any): boolean {
  if (!platforms || typeof platforms !== 'object') {
    return false;
  }

  if (Array.isArray(platforms)) {
    return false;
  }

  // Проверяем, что нет числовых ключей
  const keys = Object.keys(platforms);
  return !keys.some(key => !isNaN(Number(key)));
}

/**
 * Извлекает список платформ из объекта или массива
 */
export function extractPlatformNames(platforms: any): string[] {
  if (!platforms) {
    return [];
  }

  if (Array.isArray(platforms)) {
    return platforms
      .map(p => typeof p === 'string' ? p : p?.platform)
      .filter(Boolean);
  }

  if (typeof platforms === 'object') {
    return Object.keys(platforms).filter(key => isNaN(Number(key)));
  }

  return [];
}
