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
 */
export function getCampaignAnalyticsChannels(socialSettings: unknown): CampaignAnalyticsChannel[] {
  const settings = parseSocialSettings(socialSettings);
  const channels: CampaignAnalyticsChannel[] = [];

  for (const platform of ANALYTICS_PLATFORMS) {
    const channelId = settings?.[platform]?.analyticsChannelId;
    if (typeof channelId === 'string' && channelId.trim()) {
      channels.push({ platform, channelId: channelId.trim() });
    }
  }

  return channels;
}
