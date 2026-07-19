import { directusApi } from '../directus';
import { log } from '../utils/logger';
import axios from 'axios';
import {
  aggregatePublishedPlatformAnalytics,
} from './analytics-aggregation';

type AnalyticsPlatform = 'telegram' | 'vk';

function getResolvableCampaignChannels(
  socialSettings: Record<string, any>,
  campaignName: string | undefined,
  getFallbackChannels: (
    settings: Record<string, any>,
    name?: string,
  ) => Array<{ platform: AnalyticsPlatform; id: string; name?: string }>,
): Array<{ platform: AnalyticsPlatform; platformId: string; name?: string }> {
  const channels = getFallbackChannels(socialSettings, campaignName)
    .map(channel => ({
      platform: channel.platform,
      platformId: channel.id,
      name: channel.name,
    }));

  for (const platform of ['telegram', 'vk'] as const) {
    const platformSettings = socialSettings?.[platform] || {};
    if (
      platformSettings.analyticsChannelId
      && !channels.some(channel => channel.platform === platform)
    ) {
      channels.push({
        platform,
        platformId: String(
          platform === 'telegram'
            ? platformSettings.chatId || platformSettings.username || ''
            : platformSettings.groupId || '',
        ),
        name: campaignName,
      });
    }
  }

  return channels;
}

export class AnalyticsService {
  private static readonly ANALYTICS_PAGE_SIZE = 1000;

  private static async getPublishedContent(campaignId: string, token: string): Promise<any[]> {
    const posts: any[] = [];

    for (let offset = 0; ; offset += AnalyticsService.ANALYTICS_PAGE_SIZE) {
      const response = await directusApi.get('/items/campaign_content', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          filter: JSON.stringify({
            campaign_id: { _eq: campaignId },
            status: { _in: ['published', 'partially_published', 'partial'] },
          }),
          fields: ['id', 'title', 'status', 'social_platforms', 'scheduled_at', 'published_at'],
          sort: ['-published_at', '-id'],
          limit: AnalyticsService.ANALYTICS_PAGE_SIZE,
          offset,
        },
      });

      const page = Array.isArray(response.data?.data) ? response.data.data : [];
      posts.push(...page);

      if (page.length < AnalyticsService.ANALYTICS_PAGE_SIZE) break;
    }

    return posts;
  }

  /**
   * Получение агрегированной аналитики для кампании.
   * Читает опубликованные посты из Directus.
   * Дополняет метрики агрегатами собственных каналов кампании.
   * Это временный режим до надёжного сопоставления публикаций по postId в скрейпере.
   */
  static async getCampaignAnalytics(campaignId: string, period: string, token: string) {
    let dateFrom: Date;
    const now = new Date();

    if (period === 'thisMonth') {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else {
      const days = period === '30days' ? 30 : 7;
      dateFrom = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    }

    log(`[AnalyticsService] 📊 Запрос аналитики: campaignId=${campaignId}, period=${period}, dateFrom=${dateFrom.toISOString()}`, 'info');

    try {
      const posts = await AnalyticsService.getPublishedContent(campaignId, token);
      log(`[AnalyticsService] ✅ Получено записей контента кампании: ${posts.length}`, 'info');

      const aggregated = aggregatePublishedPlatformAnalytics(posts, dateFrom, now);
      let {
        totalPosts,
        totalViews,
        totalLikes,
        totalShares,
        totalComments,
        platformStatsMap,
      } = aggregated;

      // Дополняем метрики из скрейпера (агрегированные по каналу)
      if (totalPosts > 0) {
        try {
          await AnalyticsService.supplementFromScraper(
            campaignId, dateFrom, now, platformStatsMap,
          );
          const platformStats = Array.from(platformStatsMap.values());
          totalViews = platformStats.reduce((sum, stats) => sum + stats.views, 0);
          totalLikes = platformStats.reduce((sum, stats) => sum + stats.likes, 0);
          totalComments = platformStats.reduce((sum, stats) => sum + stats.comments, 0);
          totalShares = platformStats.reduce((sum, stats) => sum + stats.shares, 0);
        } catch (scraperErr: any) {
          log(`[AnalyticsService] Scraper supplement failed (non-critical): ${scraperErr.message}`, 'warn');
        }
      }

      const result = {
        success: true,
        totalPosts,
        totalViews,
        totalLikes,
        totalShares,
        totalComments,
        platforms: Array.from(platformStatsMap.values())
      };

      log(`[AnalyticsService] 📈 Итоговая статистика: ${totalPosts} постов, ${totalViews} просмотров`, 'info');
      return result;

    } catch (error: any) {
      log(`[AnalyticsService] ❌ Ошибка: ${error.message}`, 'error');
      if (error.response) {
        log(`[AnalyticsService] ❌ Directus: ${error.response.status} - ${JSON.stringify(error.response.data)}`, 'error');
      }
      return { success: true, totalPosts: 0, totalViews: 0, totalLikes: 0, totalShares: 0, totalComments: 0, platforms: [], error: error.message };
    }
  }

  /**
   * Дополняет статистику из скрейпер-аналитики для собственных каналов кампании.
   * Ищет публичные каналы кампании и использует доступные агрегаты скрейпера
   * за выбранный период.
   */
  private static async supplementFromScraper(
    campaignId: string,
    fromDate: Date,
    toDate: Date,
    platformStatsMap: Map<string, any>,
  ): Promise<void> {
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
    if (!adminToken) return;

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    // Получаем настройки кампании
    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 10000
    });
    const campaign = campaignResp.data?.data;
    if (!campaign) return;

    let socialSettings = campaign.social_media_settings || {};
    if (typeof socialSettings === 'string') {
      try { socialSettings = JSON.parse(socialSettings); } catch { return; }
    }

    // Каналы которые нужно искать в скрейпере
    const {
      getChannelAnalytics,
      getScraperCampaignChannels,
      resolveAnalyticsChannel,
    } = await import('./scraper-analytics');

    const channelsToLookup = getResolvableCampaignChannels(
      socialSettings,
      campaign.name,
      getScraperCampaignChannels,
    );

    if (channelsToLookup.length === 0) return;

    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    for (const ch of channelsToLookup) {
      const platformSettings = socialSettings?.[ch.platform] || {};
      const scraperChannelId = await resolveAnalyticsChannel(
        ch.platform,
        ch.platformId,
        platformSettings.analyticsChannelId,
        campaignId,
        adminToken,
        campaign.name,
      );
      if (!scraperChannelId) continue;

      const analytics = await getChannelAnalytics(
        scraperChannelId,
        { from_date: fromStr, to_date: toStr },
      );
      if (!analytics) continue;

      // Скрейпер знает канал, но данных за период у него нет (например, первичный
      // сбор ещё идёт) — его нулевые агрегаты не должны затирать сохранённые метрики.
      const hasScraperData = [
        analytics.total_views,
        analytics.total_likes,
        analytics.total_comments,
        analytics.total_shares,
      ].some(value => Number(value) > 0);
      if (!hasScraperData) {
        log(`[AnalyticsService] 📡 Скрейпер ${ch.platform}: данных за период нет — оставляем сохранённые метрики`, 'info');
        continue;
      }

      log(`[AnalyticsService] 📡 Скрейпер ${ch.platform}: ${analytics.total_views} просмотров за период`, 'info');

      if (platformStatsMap.has(ch.platform)) {
        const stats = platformStatsMap.get(ch.platform);
        stats.views = analytics.total_views;
        stats.likes = analytics.total_likes;
        stats.comments = analytics.total_comments;
        stats.shares = analytics.total_shares;
      }
    }
  }

  /**
   * Обновляет кеш аналитики для каналов кампании через скрейпер.
   * Вызывается по /api/analytics/update вместо n8n.
   */
  static async refreshCampaignAnalytics(
    campaignId: string,
    requestedDays = 7,
  ): Promise<{ success: boolean; message: string; processed?: number; failed?: number; skipped?: number }> {
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
    if (!adminToken) return { success: false, message: 'Нет токена для Directus' };

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    try {
      const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        timeout: 10000
      });
      const campaign = campaignResp.data?.data;
      if (!campaign) return { success: false, message: 'Кампания не найдена' };

      let socialSettings = campaign.social_media_settings || {};
      if (typeof socialSettings === 'string') {
        try { socialSettings = JSON.parse(socialSettings); } catch {}
      }

      const {
        getChannelParseStatus,
        getScraperCampaignChannels,
        refreshChannelMetrics,
        forceParseChannel,
        resolveAnalyticsChannel,
      } = await import('./scraper-analytics');

      const channelsToLookup = getResolvableCampaignChannels(
        socialSettings,
        campaign.name,
        getScraperCampaignChannels,
      );
      const telegramAnalyticsUnavailable = Boolean(socialSettings.telegram?.chatId)
        && !channelsToLookup.some(channel => channel.platform === 'telegram');
      const telegramWarning = telegramAnalyticsUnavailable
        ? ' Telegram пропущен: для аналитики нужен публичный @username канала.'
        : '';

      if (channelsToLookup.length === 0) {
        return {
          success: false,
          message: 'Для аналитики Telegram нужен публичный @username канала; VK должен иметь groupId',
        };
      }

      const channelObjects: Array<{ id: string; platform: string; platform_channel_id: string }> = [];
      let resolvedChannelCount = 0;

      for (const ch of channelsToLookup) {
        const platformSettings = socialSettings?.[ch.platform] || {};
        const scraperChannelId = await resolveAnalyticsChannel(
          ch.platform,
          ch.platformId,
          platformSettings.analyticsChannelId,
          campaignId,
          adminToken,
          campaign.name,
        );
        if (!scraperChannelId) continue;
        resolvedChannelCount += 1;

        const parseStatus = await getChannelParseStatus(scraperChannelId, true);
        if (parseStatus?.status === 'parsing') continue;

        if (parseStatus?.status === 'error' || !parseStatus?.last_parsed_at) {
          log(`[AnalyticsService] ⏳ Канал ${ch.platform}:${ch.platformId} ещё не спарсен — вызываем force-parse`, 'info');
          let forceResult;
          try {
            forceResult = await forceParseChannel(scraperChannelId, true);
          } catch (forceError: any) {
            const lastError = parseStatus?.last_error
              ? `Последняя ошибка парсинга: ${parseStatus.last_error}. `
              : '';
            throw new Error(`${lastError}${forceError.message}`);
          }
          if (!forceResult) {
            throw new Error(
              parseStatus?.last_error
                || `Скрапер не смог запустить сбор данных для ${ch.platform}:${ch.platformId}`,
            );
          }
          if (forceResult.status === 'completed') {
            log(`[AnalyticsService] ✅ force-parse already completed for ${ch.platform}:${ch.platformId}`, 'info');
            channelObjects.push({
              id: scraperChannelId,
              platform: ch.platform,
              platform_channel_id: ch.platformId,
            });
          } else {
            log(`[AnalyticsService] ✅ force-parse triggered for ${ch.platform}:${ch.platformId}`, 'info');
          }
          continue;
        }
        channelObjects.push({
          id: scraperChannelId,
          platform: ch.platform,
          platform_channel_id: ch.platformId,
        });
      }

      let refreshResult = null;
      if (channelObjects.length > 0) {
        const days = Math.min(30, Math.max(1, Math.trunc(requestedDays) || 7));
        refreshResult = await refreshChannelMetrics({ channels: channelObjects, days, force: true });
        if (!refreshResult || refreshResult.status === 'failed') {
          return {
            success: false,
            message: refreshResult?.errors?.join('; ') || 'Scraper не смог обновить метрики',
            processed: refreshResult?.processed || 0,
            failed: refreshResult?.failed || 0,
            skipped: refreshResult?.skipped || 0,
          };
        }
        if (refreshResult.failed > 0 || refreshResult.status === 'partial') {
          return {
            success: true,
            message: `Аналитика обновлена частично. Ошибки: ${refreshResult.errors.join('; ')}${telegramWarning}`,
            processed: refreshResult.processed || 0,
            failed: refreshResult.failed || 0,
            skipped: refreshResult.skipped || 0,
          };
        }
        log(`[AnalyticsService] 🔄 Обновление метрик запрошено для ${channelObjects.length} каналов кампании ${campaignId}`, 'info');
      } else {
        if (resolvedChannelCount === 0) {
          return {
            success: false,
            message: `Не удалось найти или зарегистрировать каналы кампании в scraper.${telegramWarning}`,
            processed: 0,
            failed: channelsToLookup.length,
            skipped: 0,
          };
        }
        log(`[AnalyticsService] ⏳ Каналы зарегистрированы, но первичный сбор данных ещё не завершён`, 'info');
        return {
          success: true,
          message: `Сбор данных по каналам уже выполняется — обновите аналитику чуть позже.${telegramWarning}`,
          processed: 0,
          failed: 0,
          skipped: 0,
        };
      }

      return {
        success: true,
        message: `Аналитика обновлена для ${channelObjects.length} канала(ов).${telegramWarning}`,
        processed: refreshResult?.processed || 0,
        failed: refreshResult?.failed || 0,
        skipped: refreshResult?.skipped || 0,
      };
    } catch (err: any) {
      log(`[AnalyticsService] ❌ refreshCampaignAnalytics error: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  }
}
