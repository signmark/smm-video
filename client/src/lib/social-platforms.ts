import type { SocialPlatform, PlatformPublishInfo } from "@/types";
import { isConfirmedPublishedPlatform } from "@shared/schedule-time";

/**
 * Платформы, которые показываются и выбираются в интерфейсе.
 *
 * Это ПОДМНОЖЕСТВО SocialPlatform: TikTok поддержан на сервере
 * (`services/social-platforms/tiktok-service.ts`, ветки в publish-scheduler),
 * но в UI публикации не предлагается.
 *
 * `as const` здесь обязателен. С аннотацией `: SocialPlatform[]` тип элемента
 * схлопывался обратно в SocialPlatform, и `SafeSocialPlatform` оказывался
 * РАВЕН SocialPlatform — то есть подмножество существовало только на словах.
 * Из-за этого карта подключений на 6 платформ не подходила к prop'у, который
 * якобы ждал те же 6, а на деле требовал 7 вместе с tiktok
 * (находка ревью 2026-07-29).
 */
export const safeSocialPlatforms = [
  'instagram',
  'facebook',
  'telegram',
  'vk',
  'youtube',
  'threads',
] as const satisfies readonly SocialPlatform[];

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

interface CardPublicationContext {
  status?: string | null;
  scheduledAt?: string | Date | null;
}

/**
 * Returns only platforms that are meaningful on a content card.
 *
 * A campaign connection alone is not enough to show an icon. The card only
 * reflects an actual publication lifecycle: a selected scheduled platform,
 * a publication attempt, or retained publication history.
 */
export function getVisibleCardPlatforms(
  socialPlatforms: Record<string, PlatformState> | null | undefined,
  context: CardPublicationContext = {},
): Record<string, PlatformState> {
  const storedPlatforms = socialPlatforms && typeof socialPlatforms === 'object'
    ? socialPlatforms
    : {};
  const isContentScheduled = context.status === 'scheduled' || !!context.scheduledAt;

  return Object.keys(storedPlatforms).reduce<Record<string, PlatformState>>((result, platform) => {
    const storedState = storedPlatforms[platform];
    if (!storedState || storedState.status === 'cancelled') {
      return result;
    }

    const hasPublishedHistory = !!storedState && (
      storedState.status === 'published' ||
      !!storedState.publishedAt ||
      !!storedState.published_at ||
      !!storedState.postUrl ||
      !!storedState.post_url
    );
    if (hasPublishedHistory) {
      result[platform] = storedState;
      return result;
    }

    if (storedState.selected === false) {
      return result;
    }

    const hasOwnSchedule = storedState.status === 'scheduled' ||
      !!storedState.scheduledAt ||
      !!storedState.scheduled_at;
    const isScheduledSelection = isContentScheduled && (
      storedState.status === 'pending' ||
      storedState.status === 'publishing' ||
      hasOwnSchedule
    );
    const hasPublicationError = storedState.status === 'failed' ||
      storedState.status === 'quota_exceeded';

    if (isScheduledSelection || hasPublicationError) {
      result[platform] = storedState;
    }

    return result;
  }, {});
}

export function getPublishedPlatformIds(
  socialPlatforms: Record<string, PlatformState> | string | null | undefined,
): string[] {
  let platforms: Record<string, PlatformState> = {};

  if (typeof socialPlatforms === 'string') {
    try {
      const parsed = JSON.parse(socialPlatforms);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        platforms = parsed;
      }
    } catch {
      return [];
    }
  } else if (socialPlatforms && typeof socialPlatforms === 'object' && !Array.isArray(socialPlatforms)) {
    platforms = socialPlatforms;
  }

  return Object.entries(platforms)
    .filter(([, state]) => isConfirmedPublishedPlatform(state))
    .map(([platform]) => platform);
}
