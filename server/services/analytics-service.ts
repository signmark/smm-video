import { directusApi } from '../directus';
import { log } from '../utils/logger';
import axios from 'axios';
import {
  aggregateCampaignChannelPosts,
  aggregatePublishedPlatformAnalytics,
  getPublishedPlatformPostIds,
  matchesPublishedPlatformPostId,
} from './analytics-aggregation';
import type { ChannelPost } from './scraper-analytics';
import { authorizeCampaignAccess } from './campaign-access';

type AnalyticsPlatform = 'telegram' | 'vk';

const KNOWN_SOCIAL_PLATFORMS = [
  'telegram',
  'vk',
  'instagram',
  'facebook',
  'threads',
  'youtube',
] as const;

function metric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasPlatformSettings(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0,
  );
}

function logAnalyticsTrace(event: string, payload: Record<string, unknown>): void {
  // Analytics diagnostics must remain visible in production. Keep payloads to
  // identifiers, decisions, and aggregate counters; never include settings or posts.
  log(
    `analytics trace=${JSON.stringify({ event, ...payload })}`,
    'analytics',
    'warn',
  );
}

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

  private static async getPublishedContent(
    campaignId: string,
    userToken: string,
    userId?: string,
    isSmmAdmin = false,
  ): Promise<any[]> {
    const posts: any[] = [];
    const serviceToken = process.env.DIRECTUS_STATIC_TOKEN
      || '';
    const canUseServiceToken = Boolean(serviceToken && (userId || isSmmAdmin));
    const readToken = canUseServiceToken ? serviceToken : userToken;

    // Directus user roles can intentionally be narrower than SMM plans. Analytics
    // is a server-side aggregate, so read it with the service credential while
    // retaining tenant isolation for ordinary users.
    const contentFilter: Record<string, unknown> = {
      campaign_id: { _eq: campaignId },
      status: { _in: ['published', 'partially_published', 'partial'] },
    };
    if (canUseServiceToken && userId && !isSmmAdmin) {
      contentFilter.user_id = { _eq: userId };
    }

    for (let offset = 0; ; offset += AnalyticsService.ANALYTICS_PAGE_SIZE) {
      const response = await directusApi.get('/items/campaign_content', {
        headers: { Authorization: `Bearer ${readToken}` },
        params: {
          filter: JSON.stringify(contentFilter),
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
  static async getCampaignAnalytics(
    campaignId: string,
    period: string,
    token: string,
    userId?: string,
    isSmmAdmin = false,
  ) {
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
      const campaign = await authorizeCampaignAccess(campaignId, userId, token, isSmmAdmin);
      const posts = await AnalyticsService.getPublishedContent(
        campaignId,
        token,
        userId,
        isSmmAdmin,
      );
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
      try {
        await AnalyticsService.supplementFromScraper(
          campaignId, dateFrom, now, posts, platformStatsMap, campaign,
        );
        const platformStats = Array.from(platformStatsMap.values());
        totalPosts = platformStats.reduce((sum, stats) => sum + stats.posts, 0);
        totalViews = platformStats.reduce((sum, stats) => sum + stats.views, 0);
        totalLikes = platformStats.reduce((sum, stats) => sum + stats.likes, 0);
        totalComments = platformStats.reduce((sum, stats) => sum + stats.comments, 0);
        totalShares = platformStats.reduce((sum, stats) => sum + stats.shares, 0);
      } catch (scraperErr: any) {
        log(`[AnalyticsService] Scraper supplement failed (non-critical): ${scraperErr.message}`, 'warn');
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

      logAnalyticsTrace('campaign_result', {
        campaignId,
        period,
        totalPosts,
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        platforms: result.platforms.map(platform => platform.name),
      });
      log(`[AnalyticsService] 📈 Итоговая статистика: ${totalPosts} постов, ${totalViews} просмотров`, 'info');
      return result;

    } catch (error: any) {
      log(`[AnalyticsService] ❌ Ошибка: ${error.message}`, 'error');
      if (error.response) {
        log(`[AnalyticsService] ❌ Directus: ${error.response.status} - ${JSON.stringify(error.response.data)}`, 'error');
      }
      throw error;
    }
  }

  /**
   * Дополняет статистику из скрейпер-аналитики для собственных каналов кампании.
   * Ищет публичные каналы кампании и использует доступные агрегаты скрейпера
   * за выбранный период.
   */
  // Публичный: переиспользуется генератором отчётов (report-generator.ts),
  // чтобы PDF/Excel накладывали те же скрапер-метрики, что и страница аналитики.
  static async supplementFromScraper(
    campaignId: string,
    fromDate: Date,
    toDate: Date,
    publishedContent: any[],
    platformStatsMap: Map<string, any>,
    campaign: any,
  ): Promise<void> {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || '';
    if (!adminToken) {
      logAnalyticsTrace('campaign_skipped', {
        campaignId,
        reason: 'missing_directus_admin_token',
      });
      return;
    }

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    let socialSettings = campaign.social_media_settings || {};
    if (typeof socialSettings === 'string') {
      try {
        socialSettings = JSON.parse(socialSettings);
      } catch {
        logAnalyticsTrace('campaign_skipped', {
          campaignId,
          reason: 'invalid_social_media_settings_json',
        });
        return;
      }
    }

    // Каналы которые нужно искать в скрейпере
    const {
      getAllChannelPosts,
      getChannelAnalytics,
      getScraperCampaignChannels,
      resolveAnalyticsChannel,
      reresolveAnalyticsChannel,
    } = await import('./scraper-analytics');

    const channelsToLookup = getResolvableCampaignChannels(
      socialSettings,
      campaign.name,
      getScraperCampaignChannels,
    );

    const settingsPresentPlatforms = KNOWN_SOCIAL_PLATFORMS.filter(platform => (
      hasPlatformSettings(socialSettings?.[platform])
    ));
    const candidatePlatforms = new Set(channelsToLookup.map(channel => channel.platform));
    const skippedPlatforms: Array<{ platform: string; reason: string }> = [];
    for (const platform of settingsPresentPlatforms) {
      if (platform !== 'telegram' && platform !== 'vk') {
        skippedPlatforms.push({
          platform,
          reason: 'unsupported_by_analytics_scraper',
        });
        continue;
      }
      if (!candidatePlatforms.has(platform)) {
        skippedPlatforms.push({
          platform,
          reason: platform === 'telegram'
            ? 'missing_public_username'
            : 'invalid_group_id',
        });
      }
    }

    logAnalyticsTrace('campaign_plan', {
      campaignId,
      settingsPresentPlatforms,
      candidates: channelsToLookup.map(channel => ({
        platform: channel.platform,
        hasCachedAnalyticsChannelId: Boolean(
          socialSettings?.[channel.platform]?.analyticsChannelId,
        ),
      })),
      skippedPlatforms,
    });

    if (channelsToLookup.length === 0) return;

    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    for (const ch of channelsToLookup) {
      const platformSettings = socialSettings?.[ch.platform] || {};
      logAnalyticsTrace('channel_resolution_start', {
        campaignId,
        platform: ch.platform,
        hasCachedAnalyticsChannelId: Boolean(platformSettings.analyticsChannelId),
      });
      let scraperChannelId = await resolveAnalyticsChannel(
        ch.platform,
        ch.platformId,
        platformSettings.analyticsChannelId,
        campaignId,
        adminToken,
        campaign.name,
      );
      if (!scraperChannelId) {
        logAnalyticsTrace('channel_skipped', {
          campaignId,
          platform: ch.platform,
          reason: 'channel_resolution_failed',
        });
        continue;
      }

      const query = { from_date: fromStr, to_date: toStr };
      let [analytics, channelPosts] = await Promise.all([
        getChannelAnalytics(scraperChannelId, query),
        getAllChannelPosts(scraperChannelId, query),
      ]);

      // Кешированный analyticsChannelId мог протухнуть (канал удалили или
      // пересоздали в скрейпере): один re-resolve и одна повторная попытка,
      // иначе аналитика кампании молча умирает до ручной правки настроек.
      if (!analytics && !channelPosts && platformSettings.analyticsChannelId === scraperChannelId) {
        const freshChannelId = await reresolveAnalyticsChannel(
          ch.platform,
          ch.platformId,
          scraperChannelId,
          campaignId,
          adminToken,
          campaign.name,
        );
        if (freshChannelId) {
          scraperChannelId = freshChannelId;
          [analytics, channelPosts] = await Promise.all([
            getChannelAnalytics(scraperChannelId, query),
            getAllChannelPosts(scraperChannelId, query),
          ]);
        }
      }

      // Channel analytics includes every post in the connected channel, including
      // manual and foreign posts. Campaign analytics may only use scraper rows whose
      // platform_post_id belongs to a confirmed publication of this campaign.
      const expectedPostIds = getPublishedPlatformPostIds(
        publishedContent,
        ch.platform,
        fromDate,
        toDate,
      );
      const matchedChannelPosts = channelPosts?.filter(post => (
        matchesPublishedPlatformPostId(expectedPostIds, post.platform_post_id)
      )) ?? null;
      // Album messages share one publication: metrics must be read per group,
      // otherwise the reaction on the sibling message is dropped (SM-15).
      const currentMetrics = channelPosts
        ? aggregateCampaignChannelPosts(channelPosts, expectedPostIds)
        : null;
      const responseSummary = {
        campaignId,
        platform: ch.platform,
        scraperChannelId,
        period: { from: fromStr, to: toStr },
        analyticsReceived: Boolean(analytics),
        postsReceived: Boolean(channelPosts),
        postRows: channelPosts?.length ?? null,
        expectedCampaignPostIds: expectedPostIds.size,
        matchedPostRows: matchedChannelPosts?.length ?? null,
        uniquePosts: currentMetrics ? currentMetrics.posts : null,
        source: matchedChannelPosts ? 'campaign_posts_dedup' : null,
        metrics: currentMetrics || null,
      };
      logAnalyticsTrace('channel_response_summary', responseSummary);

      if (!currentMetrics) {
        logAnalyticsTrace('channel_skipped', {
          campaignId,
          platform: ch.platform,
          scraperChannelId,
          reason: channelPosts ? 'no_campaign_post_match' : 'no_post_level_attribution',
        });
        continue;
      }

      // Скрейпер знает канал, но данных за период у него нет (например, первичный
      // сбор ещё идёт) — его нулевые агрегаты не должны затирать сохранённые метрики.
      const hasScraperData = channelPosts
        ? currentMetrics.posts > 0
        : [
            currentMetrics.views,
            currentMetrics.likes,
            currentMetrics.comments,
            currentMetrics.shares,
          ].some(value => value > 0);
      if (!hasScraperData) {
        logAnalyticsTrace('channel_skipped', {
          campaignId,
          platform: ch.platform,
          scraperChannelId,
          reason: 'empty_period_data',
          keptStoredMetrics: platformStatsMap.has(ch.platform),
        });
        log(`[AnalyticsService] 📡 Скрейпер ${ch.platform}: данных за период нет — оставляем сохранённые метрики`, 'info');
        continue;
      }

      logAnalyticsTrace('channel_included', {
        campaignId,
        platform: ch.platform,
        scraperChannelId,
        metrics: currentMetrics,
      });
      log(`[AnalyticsService] 📡 Скрейпер ${ch.platform}: ${currentMetrics.views} просмотров за период`, 'info');

      const stats = platformStatsMap.get(ch.platform) || {
        name: ch.platform,
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      };
      // Directus publications are authoritative for the count. Scraper rows only
      // enrich engagement metrics for matching platform post IDs.
      stats.views = currentMetrics.views;
      stats.likes = currentMetrics.likes;
      stats.comments = currentMetrics.comments;
      stats.shares = currentMetrics.shares;
      platformStatsMap.set(ch.platform, stats);
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
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || '';
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
        reresolveAnalyticsChannel,
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
        let scraperChannelId = await resolveAnalyticsChannel(
          ch.platform,
          ch.platformId,
          platformSettings.analyticsChannelId,
          campaignId,
          adminToken,
          campaign.name,
        );
        if (!scraperChannelId) continue;
        resolvedChannelCount += 1;

        // Протухший кешированный UUID (канал пересоздан в скрейпере): один
        // re-resolve и одна повторная попытка. При неудаче пробрасываем исходную
        // ошибку, сохраняя прежние пользователю сообщения об ошибках.
        let parseStatus: Awaited<ReturnType<typeof getChannelParseStatus>> = null;
        try {
          parseStatus = await getChannelParseStatus(scraperChannelId, true);
        } catch (statusError) {
          if (platformSettings.analyticsChannelId !== scraperChannelId) throw statusError;
          const freshChannelId = await reresolveAnalyticsChannel(
            ch.platform,
            ch.platformId,
            scraperChannelId,
            campaignId,
            adminToken,
            campaign.name,
          );
          if (!freshChannelId) throw statusError;
          scraperChannelId = freshChannelId;
          parseStatus = await getChannelParseStatus(scraperChannelId, true);
        }
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
