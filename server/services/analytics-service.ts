import { directusApi } from '../directus';
import { log } from '../utils/logger';

export class AnalyticsService {
  /**
   * Получение агрегированной аналитики для кампании
   * @param campaignId ID кампании
   * @param period Период (7days или 30days)
   * @param token Токен пользователя
   */
  static async getCampaignAnalytics(campaignId: string, period: string, token: string) {
    const days = period === '30days' ? 30 : 7;
    log(`[AnalyticsService] 📊 Запрос аналитики: campaignId=${campaignId}, period=${period} (${days} дней)`, 'info');

    try {
      // Прямой запрос к Directus для получения опубликованного контента за период
      // Используем фильтр Directus для даты
      const response = await directusApi.get('/items/campaign_content', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          filter: {
            campaign_id: { _eq: campaignId },
            status: { _eq: 'published' },
            published_at: { _gte: `$NOW(-${days} days)` }
          },
          fields: ['id', 'title', 'social_platforms', 'published_at'],
          limit: 1000
        }
      });

      const posts = response.data?.data || [];
      log(`[AnalyticsService] ✅ Найдено опубликованных постов: ${posts.length}`, 'info');

      // Инициализируем агрегаторы
      let totalPosts = 0;
      let totalViews = 0;
      let totalLikes = 0;
      let totalShares = 0;
      let totalComments = 0;

      const platformStatsMap = new Map<string, any>();

      // Агрегируем данные по всем постам и платформам
      posts.forEach((post: any) => {
        if (post.social_platforms) {
          // Обработка social_platforms (может быть объектом или JSON-строкой в зависимости от настроек Directus)
          let platforms = post.social_platforms;
          if (typeof platforms === 'string') {
            try {
              platforms = JSON.parse(platforms);
            } catch (e) {
              log(`[AnalyticsService] ⚠️ Ошибка парсинга social_platforms для поста ${post.id}`, 'warn');
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

                // Название платформы для группировки
                const platformName = (platformData.platform || platformKey).toLowerCase();
                
                if (!platformStatsMap.has(platformName)) {
                  platformStatsMap.set(platformName, {
                    name: platformName,
                    posts: 0,
                    views: 0,
                    likes: 0,
                    shares: 0,
                    comments: 0
                  });
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

      // В случае ошибки возвращаем пустую, но корректную структуру данных
      return {
        success: true, // true, чтобы фронтенд показал пустые данные вместо ошибки
        totalPosts: 0,
        totalViews: 0,
        totalLikes: 0,
        totalShares: 0,
        totalComments: 0,
        platforms: [],
        error: error.message // Опционально передаем ошибку
      };
    }
  }
}
