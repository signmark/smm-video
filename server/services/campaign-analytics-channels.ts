/**
 * Связывает кампанию с её каналами в Analytics API.
 *
 * Analytics API сам парсит каналы по расписанию, каждые 6 часов обновляет метрики
 * за последние 7 дней и считает динамику постов. Нам достаточно знать UUID канала,
 * чтобы спросить у него готовые цифры — своего опроса соцсетей мы не заводим.
 *
 * UUID кладётся в social_media_settings[platform].analyticsChannelId при первом
 * обращении (см. persistAnalyticsChannelId в scraper-analytics.ts). Здесь читаем
 * только уже сохранённое: регистрация канала — не наша забота, и молчаливо
 * создавать каналы из фонового цикла нельзя.
 */

export type AnalyticsPlatform = 'telegram' | 'vk';

export interface CampaignAnalyticsChannel {
  platform: AnalyticsPlatform;
  /** UUID канала в Analytics API. */
  channelId: string;
}

const ANALYTICS_PLATFORMS: AnalyticsPlatform[] = ['telegram', 'vk'];

/** Разбирает social_media_settings, которое в Directus бывает и строкой, и объектом. */
export function parseSocialSettings(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : {};
}

/**
 * Возвращает каналы кампании, для которых уже известен UUID в Analytics API.
 * Пустой массив означает «аналитика по этой кампании пока не подключена» —
 * это нормальное состояние, а не ошибка.
 *
 * `monitoredIndex` (см. buildMonitoredChannelIndex) позволяет доузнать UUID для
 * кампаний, у которых он ещё не сохранён: analyticsChannelId пишется лениво, только
 * когда кто-то откроет раздел Аналитика. Без этого фоновые уведомления молчали бы,
 * пока пользователь сам не зайдёт в аналитику.
 *
 * Сопоставление идёт ТОЛЬКО по уже заведённым в мониторинге каналам. Регистрировать
 * новые нельзя: createMonitoringChannel запускает на стороне Analytics API парсинг
 * за 30 дней, и делать это молча из фонового цикла — не то поведение, которого ждут.
 */
export function getCampaignAnalyticsChannels(
  socialSettings: unknown,
  monitoredIndex?: Map<string, string>,
): CampaignAnalyticsChannel[] {
  const settings = parseSocialSettings(socialSettings);
  const channels: CampaignAnalyticsChannel[] = [];
  const seen = new Set<AnalyticsPlatform>();

  for (const platform of ANALYTICS_PLATFORMS) {
    const channelId = settings?.[platform]?.analyticsChannelId;
    if (typeof channelId === 'string' && channelId.trim()) {
      channels.push({ platform, channelId: channelId.trim() });
      seen.add(platform);
    }
  }

  if (!monitoredIndex || monitoredIndex.size === 0) return channels;

  // Те же правила нормализации, что и у getScraperCampaignChannels: Telegram — по
  // публичному @username, VK — по числовому groupId.
  for (const { platform, platformChannelId } of listCampaignPlatformChannels(settings)) {
    if (seen.has(platform)) continue;
    const uuid = monitoredIndex.get(`${platform}:${platformChannelId}`);
    if (uuid) {
      channels.push({ platform, channelId: uuid });
      seen.add(platform);
    }
  }

  return channels;
}

/** Идентификаторы каналов кампании на самих площадках (не UUID Analytics API). */
function listCampaignPlatformChannels(
  settings: Record<string, any>,
): Array<{ platform: AnalyticsPlatform; platformChannelId: string }> {
  const result: Array<{ platform: AnalyticsPlatform; platformChannelId: string }> = [];

  const rawTelegram = String(settings?.telegram?.chatId ?? settings?.telegram?.username ?? '').trim();
  if (rawTelegram.startsWith('@')) {
    result.push({ platform: 'telegram', platformChannelId: rawTelegram });
  } else if (rawTelegram && !/^-?\d+$/.test(rawTelegram)) {
    result.push({ platform: 'telegram', platformChannelId: `@${rawTelegram}` });
  }

  const vkGroupId = String(settings?.vk?.groupId ?? '').trim();
  if (vkGroupId && /^-?\d+$/.test(vkGroupId)) {
    result.push({ platform: 'vk', platformChannelId: vkGroupId });
  }

  return result;
}

/**
 * Строит индекс «platform:platform_channel_id → UUID» по каналам, уже заведённым
 * в мониторинге. Один запрос за цикл на все кампании.
 */
export function buildMonitoredChannelIndex(
  items: Array<{ id: string; platform: string; platform_channel_id: string }>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    if (!item?.id || !item?.platform || !item?.platform_channel_id) continue;
    index.set(`${item.platform}:${item.platform_channel_id}`, item.id);
  }
  return index;
}
