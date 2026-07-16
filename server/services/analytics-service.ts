import { directusApi } from '../directus';
import { log } from '../utils/logger';
import axios from 'axios';
import {
  aggregatePublishedPlatformAnalytics,
  getPublishedPlatformPostIds,
  matchesPublishedPlatformPostId,
} from './analytics-aggregation';

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
   * Дополняет метрики данными скрейпера, сопоставляя конкретные публикации по postId.
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

      // Обновляем метрики поддерживаемых платформ только для публикаций кампании,
      // которые скрейпер смог однозначно сопоставить по postId.
      if (totalPosts > 0) {
        try {
          await AnalyticsService.supplementFromScraper(
            campaignId, posts, dateFrom, now, platformStatsMap,
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
   * Ищет каналы кампании (TG chatId, VK groupId), затем суммирует метрики только
   * тех публикаций, чьи platform_post_id совпадают с сохранёнными postId кампании.
   */
  private static async supplementFromScraper(
    campaignId: string,
    campaignPosts: any[],
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
    const channelsToLookup: Array<{ platform: string; platformId: string }> = [];
    if (socialSettings.telegram?.chatId) {
      channelsToLookup.push({ platform: 'telegram', platformId: String(socialSettings.telegram.chatId) });
    }
    if (socialSettings.vk?.groupId) {
      channelsToLookup.push({ platform: 'vk', platformId: String(socialSettings.vk.groupId) });
    }

    if (channelsToLookup.length === 0) return;

    const { getMonitoredChannels, getChannelPosts } = await import('./scraper-analytics');
    const monitored = await getMonitoredChannels({ page_size: 100 });
    if (!monitored.items.length) return;

    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    for (const ch of channelsToLookup) {
      const found = monitored.items.find(m =>
        m.platform === ch.platform && m.platform_channel_id === ch.platformId
      );
      if (!found) continue;

      const campaignPostIds = getPublishedPlatformPostIds(
        campaignPosts, ch.platform, fromDate, toDate,
      );
      if (campaignPostIds.size === 0) continue;

      const matchedPostKeys = new Set<string>();
      const matchedMetrics = { views: 0, likes: 0, comments: 0, shares: 0 };

      for (let page = 1; ; page++) {
        const response = await getChannelPosts(found.id, {
          page,
          page_size: 100,
          from_date: fromStr,
          to_date: toStr,
        });
        if (!response) break;

        for (const scraperPost of response.items || []) {
          if (!matchesPublishedPlatformPostId(campaignPostIds, scraperPost.platform_post_id)) continue;
          const uniqueKey = scraperPost.id || scraperPost.platform_post_id;
          if (matchedPostKeys.has(uniqueKey)) continue;
          matchedPostKeys.add(uniqueKey);
          matchedMetrics.views += Number(scraperPost.views) || 0;
          matchedMetrics.likes += Number(scraperPost.likes) || 0;
          matchedMetrics.comments += Number(scraperPost.comments) || 0;
          matchedMetrics.shares += Number(scraperPost.shares) || 0;
        }

        if (!response.has_next_page || !response.items?.length) break;
      }

      const analytics = {
        total_views: matchedMetrics.views,
        total_likes: matchedMetrics.likes,
        total_comments: matchedMetrics.comments,
        total_shares: matchedMetrics.shares,
      };
      log(`[AnalyticsService] 📡 Скрейпер ${ch.platform}: ${analytics.total_views} просмотров за период`, 'info');

      if (matchedPostKeys.size > 0 && platformStatsMap.has(ch.platform)) {
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
  static async refreshCampaignAnalytics(campaignId: string): Promise<{ success: boolean; message: string }> {
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

      const channelsToLookup: Array<{ platform: string; platformId: string }> = [];
      if (socialSettings.telegram?.chatId) {
        channelsToLookup.push({ platform: 'telegram', platformId: String(socialSettings.telegram.chatId) });
      }
      if (socialSettings.vk?.groupId) {
        channelsToLookup.push({ platform: 'vk', platformId: String(socialSettings.vk.groupId) });
      }

      if (channelsToLookup.length === 0) {
        return { success: true, message: 'Каналы кампании не зарегистрированы в скрейпере' };
      }

      const { getMonitoredChannels, refreshChannelMetrics, ensureChannelsRegistered, forceParseChannel } = await import('./scraper-analytics');

      // Регистрируем если не зарегистрированы
      await ensureChannelsRegistered(channelsToLookup.map(ch => ({
        platform: ch.platform,
        id: ch.platformId
      })));

      const monitored = await getMonitoredChannels({ page_size: 100 });
      const channelObjects: Array<{ id: string; platform: string; platform_channel_id: string }> = [];

      for (const ch of channelsToLookup) {
        const found = monitored.items.find(m =>
          m.platform === ch.platform && m.platform_channel_id === ch.platformId
        );
        if (found) {
          if (!found.last_parsed_at) {
            log(`[AnalyticsService] ⏳ Канал ${found.platform}:${found.platform_channel_id} ещё не спарсен — вызываем force-parse`, 'info');
            try {
              await forceParseChannel(found.id);
              log(`[AnalyticsService] ✅ force-parse triggered for ${found.platform}:${found.platform_channel_id}`, 'info');
            } catch (parseErr: any) {
              log(`[AnalyticsService] ⚠️ force-parse failed for ${found.id}: ${parseErr.message}`, 'warn');
            }
            continue;
          }
          channelObjects.push({
            id: found.id,
            platform: found.platform,
            platform_channel_id: found.platform_channel_id
          });
        }
      }

      if (channelObjects.length > 0) {
        await refreshChannelMetrics({ channels: channelObjects, days: 30 });
        log(`[AnalyticsService] 🔄 Обновление метрик запрошено для ${channelObjects.length} каналов кампании ${campaignId}`, 'info');
      } else {
        log(`[AnalyticsService] ⏳ Все каналы ещё не спарсены — metrics-refresh не вызывается`, 'info');
      }

      return { success: true, message: `Обновление аналитики запущено для ${channelObjects.length} канала(ов)` };
    } catch (err: any) {
      log(`[AnalyticsService] ❌ refreshCampaignAnalytics error: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  }
}
