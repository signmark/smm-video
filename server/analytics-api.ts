import express from 'express';
import axios from 'axios';

const router = express.Router();

// Directus API базовый URL
const directusApi = axios.create({
  baseURL: process.env.DIRECTUS_URL,
  timeout: 30000,
});

/**
 * API эндпоинт для получения аналитики кампании
 */
router.get('/analytics', async (req, res) => {
  try {
    const { campaignId, period = '7days' } = req.query;
    
    if (!campaignId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Параметр campaignId обязателен' 
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        error: 'Требуется авторизация' 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const days = period === '30days' ? 30 : 7;

    console.log(`[Analytics API] Запрос аналитики для кампании ${campaignId}, период: ${days} дней`);

    // Получаем данные из Directus
    const directusResponse = await directusApi.get('/items/campaign_content', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter[campaign_id][_eq]': campaignId,
        'filter[status][_eq]': 'published',
        'filter[published_at][_gte]': `$NOW(-${days} days)`,
        'fields': ['id', 'title', 'social_platforms', 'published_at'],
        'limit': 1000
      }
    });

    const contentItems = directusResponse.data?.data || [];
    console.log(`[Analytics API] Получено ${contentItems.length} элементов контента`);

    // Обрабатываем данные
    let totalPosts = 0, totalViews = 0, totalLikes = 0, totalShares = 0, totalComments = 0;
    const platformStats: Record<string, any> = {};

    contentItems.forEach((content: any) => {
      if (!content.social_platforms) return;
      
      let socialPlatforms;
      try {
        socialPlatforms = typeof content.social_platforms === 'string' 
          ? JSON.parse(content.social_platforms) : content.social_platforms;
      } catch { return; }

      Object.entries(socialPlatforms).forEach(([platformKey, platformData]: [string, any]) => {
        if (!platformData || platformData.status !== 'published') return;
        
        totalPosts++;
        const analytics = platformData.analytics || {};
        const views = analytics.views || 0;
        const likes = analytics.likes || 0;
        const shares = analytics.shares || 0;
        const comments = analytics.comments || 0;

        totalViews += views;
        totalLikes += likes;
        totalShares += shares;
        totalComments += comments;

        const platformName = (platformData.platform || platformKey).charAt(0).toUpperCase() + 
                            (platformData.platform || platformKey).slice(1);

        if (!platformStats[platformName]) {
          platformStats[platformName] = { posts: 0, views: 0, likes: 0, shares: 0, comments: 0 };
        }

        platformStats[platformName].posts++;
        platformStats[platformName].views += views;
        platformStats[platformName].likes += likes;
        platformStats[platformName].shares += shares;
        platformStats[platformName].comments += comments;
      });
    });

    const platforms = Object.entries(platformStats).map(([name, stats]) => ({ name, ...stats }));

    console.log(`[Analytics API] Итого: ${totalPosts} постов на ${platforms.length} платформах`);

    return res.json({
      totalPosts, totalViews, totalLikes, totalShares, totalComments, platforms
    });

  } catch (error: any) {
    console.error('[Analytics API] Ошибка:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении аналитики',
      details: error.message 
    });
  }
});

export default router;