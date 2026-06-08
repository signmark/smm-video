import { directusApi } from '../directus';
import { log } from '../utils/logger';

export class AnalyticsService {
  /**
   * Получение агрегированной аналитики для кампании
   * @param period Период (7days, 30days, thisMonth)
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
          try {
            platforms = JSON.parse(platforms);
          } catch {
            return;
          }
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
      log(`[AnalyticsService] ❌ Ошибка при получении данных: ${error.message}`, 'error');
      if (error.response) {
        log(`[AnalyticsService] ❌ Ответ Directus: ${error.response.status} - ${JSON.stringify(error.response.data)}`, 'error');
      }

      return {
        success: true,
        totalPosts: 0,
        totalViews: 0,
        totalLikes: 0,
        totalShares: 0,
        totalComments: 0,
        platforms: [],
        error: error.message
      };
    }
  }
}
