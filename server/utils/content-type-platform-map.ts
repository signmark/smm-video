/**
 * Соответствия: какие типы контента поддерживает каждая платформа.
 *
 * Типы контента:
 *   text          — текст без медиа
 *   text-image    — текст + картинка
 *   image         — только изображение
 *   video         — обычное видео
 *   clip          — короткий клип / Reels
 *   reel          — Instagram Reels
 *   stories       — Stories
 *   shorts        — YouTube Shorts
 *   carousel      — карусель из нескольких изображений
 */
export const PLATFORM_SUPPORTED_CONTENT_TYPES: Record<string, string[]> = {
  youtube:   ['video', 'clip', 'shorts', 'reel'],
  tiktok:    ['video', 'clip', 'shorts', 'reel'],
  instagram: ['text', 'text-image', 'image', 'video', 'clip', 'reel', 'stories', 'carousel'],
  facebook:  ['text', 'text-image', 'image', 'video', 'clip', 'carousel'],
  vk:        ['text', 'text-image', 'image', 'video', 'clip'],
  telegram:  ['text', 'text-image', 'image', 'video', 'clip'],
  threads:   ['text', 'text-image', 'image', 'video'],
};

/** Платформы, принимающие ТОЛЬКО видеоконтент */
export const VIDEO_ONLY_PLATFORMS = ['youtube', 'tiktok'];

/** Платформы по умолчанию для текстового / текст+картинка контента */
export const DEFAULT_PLATFORMS_TEXT_IMAGE = ['vk', 'telegram', 'facebook', 'instagram', 'threads'];

/** Платформы по умолчанию для видеоконтента */
export const DEFAULT_PLATFORMS_VIDEO = ['vk', 'telegram', 'facebook', 'instagram', 'youtube', 'tiktok'];

/**
 * Проверяет, поддерживает ли платформа данный тип контента.
 * Если тип контента неизвестен — разрешаем публикацию (не блокируем).
 */
export function isPlatformCompatible(platform: string, contentType: string | undefined | null): boolean {
  const supported = PLATFORM_SUPPORTED_CONTENT_TYPES[platform];
  if (!supported) return true;          // неизвестная платформа — не блокируем
  if (!contentType) return true;        // тип не задан — не блокируем
  return supported.includes(contentType);
}

/**
 * Возвращает человекочитаемое описание ошибки несовместимости.
 */
export function getIncompatibilityReason(platform: string, contentType: string): string {
  const supported = PLATFORM_SUPPORTED_CONTENT_TYPES[platform];
  if (!supported) return '';
  const supportedStr = supported.join(', ');
  const labels: Record<string, string> = {
    youtube: 'YouTube поддерживает только видеоконтент',
    tiktok:  'TikTok поддерживает только видеоконтент',
  };
  const label = labels[platform] || `${platform} не поддерживает данный тип`;
  return `${label} (поддерживается: ${supportedStr}). Текущий тип: ${contentType}`;
}

/**
 * Фильтрует список платформ, оставляя только совместимые с типом контента.
 */
export function filterCompatiblePlatforms(platforms: string[], contentType: string | undefined | null): string[] {
  return platforms.filter(p => isPlatformCompatible(p, contentType));
}
