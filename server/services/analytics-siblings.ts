/**
 * SM-15, решение владельца 19.08: «Хорошо бы написать, посты из какой кампании
 * учтены».
 *
 * Один канал часто ведут несколько кампаний: по боевой базе таких телеграм-
 * каналов шесть, по две-три кампании на каждый. Их публикации попадают во
 * вторую цифру («по каналу»), но в аналитику текущей кампании — нет, и
 * правильно. Здесь мы находим эти соседние кампании, чтобы разницу можно было
 * назвать по именам, а не оставлять безымянным числом.
 *
 * Сопоставление каналов вынесено отдельными чистыми функциями: сравнение
 * идентификаторов — единственное место, где легко ошибиться и приписать
 * кампании чужой канал.
 */

import type { SiblingCampaign } from './analytics-aggregation';

export type SiblingPlatform = 'telegram' | 'vk';

/**
 * Приводит идентификатор канала к сравнимому виду.
 *
 * Telegram один и тот же канал пишут как `@name`, `name`, `https://t.me/name`
 * и числовым `-100…`; VK — как `club123`, `-123`, `123`. Без нормализации
 * соседняя кампания «не находится» ровно там, где настройки заполнены
 * по-человечески, а не по образцу.
 */
export function normalizeChannelKey(platform: SiblingPlatform, value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';

  if (platform === 'telegram') {
    const withoutHost = raw.replace(/^https?:\/\/(t\.me|telegram\.me)\//, '');
    return withoutHost.replace(/^@/, '').replace(/\/$/, '');
  }

  const digits = raw.match(/-?\d+/)?.[0] || '';
  return digits ? digits.replace(/^-/, '') : raw;
}

/** Все идентификаторы канала, которыми кампания могла его записать. */
export function channelKeysOf(settings: any, platform: SiblingPlatform): string[] {
  const platformSettings = settings?.[platform] || {};
  const candidates = platform === 'telegram'
    ? [platformSettings.chatId, platformSettings.username, platformSettings.channelName]
    : [platformSettings.groupId, platformSettings.groupName];

  return candidates
    .map(value => normalizeChannelKey(platform, value))
    .filter(Boolean);
}

export interface ChannelTarget {
  platform: SiblingPlatform;
  /** Идентификатор канала так, как он записан в текущей кампании. */
  platformId: string;
  /** Идентификатор канала в скрейпере — самый надёжный признак «тот же канал». */
  scraperChannelId?: string;
}

/** Ведёт ли кампания с такими настройками ТОТ ЖЕ канал. */
export function campaignSharesChannel(settings: any, target: ChannelTarget): boolean {
  const platformSettings = settings?.[target.platform] || {};

  // Идентификатор скрейпера сравниваем первым: он один на канал и не зависит
  // от того, как человек записал имя канала в настройках.
  if (
    target.scraperChannelId
    && platformSettings.analyticsChannelId
    && String(platformSettings.analyticsChannelId) === String(target.scraperChannelId)
  ) {
    return true;
  }

  const wanted = normalizeChannelKey(target.platform, target.platformId);
  if (!wanted) return false;
  return channelKeysOf(settings, target.platform).includes(wanted);
}

export interface SiblingCandidate {
  id: string;
  name?: string;
  social_media_settings?: any;
}

export interface SiblingLookupDeps {
  /** Кампании того же владельца, кроме текущей. */
  listCandidates: () => Promise<SiblingCandidate[]>;
  /** Идентификаторы постов кампании, опубликованных в этом канале за период. */
  publishedIdsOf: (campaignId: string) => Promise<Set<string>>;
}

/**
 * Соседние кампании этого канала вместе с их публикациями за период.
 *
 * Пустой список — нормальный исход: канал ведёт одна кампания, раскладывать
 * нечего. Ошибка чтения тоже даёт пустой список: аналитика обязана рисоваться
 * и без разложения, а не падать целиком из-за необязательной подробности.
 */
export async function collectSiblingCampaigns(
  target: ChannelTarget,
  deps: SiblingLookupDeps,
  onError?: (reason: string) => void,
): Promise<SiblingCampaign[]> {
  let candidates: SiblingCandidate[];
  try {
    candidates = await deps.listCandidates();
  } catch (error: any) {
    onError?.(`list_candidates_failed: ${error?.message || 'unknown'}`);
    return [];
  }

  const shared = candidates.filter(candidate => (
    campaignSharesChannel(parseSettings(candidate.social_media_settings), target)
  ));

  const siblings: SiblingCampaign[] = [];
  for (const candidate of shared) {
    try {
      const expectedIds = await deps.publishedIdsOf(candidate.id);
      if (expectedIds.size === 0) continue;
      siblings.push({
        campaignId: candidate.id,
        name: candidate.name || 'Без названия',
        expectedIds,
      });
    } catch (error: any) {
      onError?.(`published_ids_failed: ${error?.message || 'unknown'}`);
    }
  }

  return siblings;
}

function parseSettings(value: any): any {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
