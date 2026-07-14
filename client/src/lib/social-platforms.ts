import type { SocialPlatform, PlatformPublishInfo } from "@/types";

// Массив доступных социальных платформ для безопасного использования в коде
export const safeSocialPlatforms: SocialPlatform[] = [
  'instagram',
  'facebook',
  'telegram',
  'vk',
  'youtube',
  'threads'
];

// Тип для более безопасной работы с платформами
export type SafeSocialPlatform = typeof safeSocialPlatforms[number];

// Упакованный тип для всех платформ
export type SocialPlatforms = Record<SafeSocialPlatform, PlatformPublishInfo>;

// Словарь с переводами названий платформ для отображения в UI
export const platformNames: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  youtube: 'YouTube',
  threads: 'Threads',
  tiktok: 'TikTok'
};

// Иконки для платформ (можно расширить при необходимости)
export const platformIcons: Record<SocialPlatform, string> = {
  instagram: 'instagram',
  facebook: 'facebook',
  telegram: 'send',
  vk: 'message-circle',
  youtube: 'play',
  threads: 'threads',
  tiktok: 'music'
};

export const platformColors: Record<SocialPlatform, string> = {
  instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
  facebook: 'bg-blue-600',
  telegram: 'bg-blue-400',
  vk: 'bg-blue-500',
  youtube: 'bg-red-600',
  threads: 'bg-black',
  tiktok: 'bg-black'
};

type PlatformState = Record<string, any>;

/**
 * Returns only platforms that are meaningful on a content card.
 *
 * Draft and scheduled content is limited to accounts that are actually
 * connected to the campaign. Published entries are retained even if the
 * account was disconnected later, so publication history and links are not
 * lost from the UI.
 */
export function getVisibleCardPlatforms(
  socialPlatforms: Record<string, PlatformState> | null | undefined,
  connectedPlatforms: Record<string, boolean> | null,
): Record<string, PlatformState> {
  const storedPlatforms = socialPlatforms && typeof socialPlatforms === 'object'
    ? socialPlatforms
    : {};
  const platformOrder = Array.from(new Set([
    ...safeSocialPlatforms,
    ...Object.keys(storedPlatforms),
  ]));

  return platformOrder.reduce<Record<string, PlatformState>>((result, platform) => {
    const storedState = storedPlatforms[platform];
    const hasPublishedHistory = !!storedState && (
      storedState.status === 'published' ||
      !!storedState.publishedAt ||
      !!storedState.published_at ||
      !!storedState.postUrl ||
      !!storedState.post_url
    );

    if (connectedPlatforms?.[platform] || hasPublishedHistory) {
      result[platform] = storedState || {
        platform,
        status: 'connected',
        publishedAt: null,
        selected: true,
      };
    }

    return result;
  }, {});
}
