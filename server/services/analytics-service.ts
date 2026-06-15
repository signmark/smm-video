import { directusApi } from '../directus';
import { log } from '../utils/logger';
import axios from 'axios';

export class AnalyticsService {
  /**
   * Получение агрегированной аналитики для кампании.
   * Читает опубликованные посты из Directus.
   * Если views = 0, дополняет данными из скрейпера для каналов кампании.
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
      const response = await directusApi.get('/items/campaign_content', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          filter: JSON.stringify({
            campaign_id: { _eq: campaignId },
            status: { _in: ['published', 'partially_published'] },
            scheduled_at: { _gte: dateFrom.toISOString() }
          }),
          fields: ['id', 'title', 'social_platforms', 'scheduled_at', 'published_at'],
          limit: 1000
        }
      });

      const posts = response.data?.data || [];
      log(`[AnalyticsService] ✅ Найдено опубликованных постов: ${posts.length}`, 'info');

      let totalPosts = 0;
      let totalViews = 0;
      let totalLikes = 0;
      let totalShares = 0;
      let totalComments = 0;

      const platformStatsMap = new Map<string, any>();

      posts.forEach((post: any) => {
        if (!post.social_platforms) return;

        let platforms = post.social_platforms;
        if (typeof platforms === 'string') {
          try { platforms = JSON.parse(platforms); } catch { return; }
        }

        if (platforms && typeof platforms === 'object') {
          Object.entries(platforms).forEach(([platformKey, platformData]: [string, any]) => {
            if (platformData && platformData.status === 'published') {
              totalPosts++;

              const analytics = platformData.analytics || {};
              const views = Number(analytics.views || 0);
              const likes = Number(analytics.likes || 0);
              const shares = Number(analytics.shares || 0);
              const comments = Number(analytics.comments || 0);

              totalViews += views;
              totalLikes += likes;
              totalShares += shares;
              totalComments += comments;

              const platformName = (platformData.platform || platformKey).toLowerCase();
              if (!platformStatsMap.has(platformName)) {
                platformStatsMap.set(platformName, { name: platformName, posts: 0, views: 0, likes: 0, shares: 0, comments: 0 });
              }
              const stats = platformStatsMap.get(platformName);
              stats.posts++;
              stats.views += views;
              stats.likes += likes;
              stats.shares += shares;
              stats.comments += comments;
            }
          });
        }
      });

      // Если нет данных о просмотрах в Directus — пробуем скрейпер для каналов кампании
      if (totalViews === 0 && totalPosts > 0) {
        try {
          await AnalyticsService.supplementFromScraper(
            campaignId, dateFrom, now,
            platformStatsMap,
            (v, l, c, s) => { totalViews += v; totalLikes += l; totalComments += c; totalShares += s; }
          );
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
   * Ищет каналы кампании (TG chatId, VK groupId) в мониторинге скрейпера
   * и берёт агрегированные просмотры/лайки за период.
   */
  private static async supplementFromScraper(
    campaignId: string,
    fromDate: Date,
    toDate: Date,
    platformStatsMap: Map<string, any>,
    addTotals: (views: number, likes: number, comments: number, shares: number) => void
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

    const { getMonitoredChannels, getChannelAnalytics } = await import('./scraper-analytics');
    const monitored = await getMonitoredChannels({ page_size: 100 });
    if (!monitored.items.length) return;

    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    for (const ch of channelsToLookup) {
      const found = monitored.items.find(m =>
        m.platform === ch.platform && m.platform_channel_id === ch.platformId
      );
      if (!found) continue;

      const analytics = await getChannelAnalytics(found.id, { from_date: fromStr, to_date: toStr });
      if (!analytics) continue;

      addTotals(analytics.total_views, analytics.total_likes, analytics.total_comments, analytics.total_shares);
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
