import express from 'express';
import axios from 'axios';

const app = express();
// Простой CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});
app.use(express.json());

// Простой API для аналитики на отдельном порту
app.get('/analytics', async (req, res) => {
  console.log('[Analytics Server] 🎯 Получен запрос на /analytics');
  
  try {
    const { campaignId, period = '7days' } = req.query;
    
    if (!campaignId) {
      return res.status(400).json({ 
        success: false, 
        error: 'campaignId is required' 
      });
    }

    console.log('[Analytics Server] 📊 Параметры:', { campaignId, period });

    // Получаем данные из Directus
    const daysBack = period === '30days' ? 30 : 7;
    const dateFilter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    
    const directusUrl = `${process.env.DIRECTUS_URL}/items/campaign_content`;
    const params = {
      'filter[campaign_id][_eq]': campaignId,
      'filter[status][_eq]': 'published',
      'filter[published_at][_gte]': dateFilter,
      'fields': 'id,title,content,social_platforms,published_at,status'
    };

    console.log('[Analytics Server] 🌐 Запрос к Directus:', directusUrl);
    
    const response = await axios.get(directusUrl, { 
      params,
      headers: {
        'Authorization': 'Bearer TmWM9gUU8RxLwRGe8kcMI-oopnvqYjF6'
      }
    });

    const content = response.data.data || [];
    console.log('[Analytics Server] 📄 Получено контента:', content.length);

    // Подсчет постов по платформам
    let totalPosts = 0;
    const platformStats = {
      telegram: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 },
      instagram: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 },
      vk: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 },
      facebook: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 }
    };

    content.forEach(item => {
      if (item.social_platforms) {
        const platforms = typeof item.social_platforms === 'string' 
          ? JSON.parse(item.social_platforms) 
          : item.social_platforms;

        Object.keys(platforms).forEach(platformKey => {
          const platform = platforms[platformKey];
          if (platform.status === 'published') {
            totalPosts++;
            
            const platformName = platform.platform || platformKey;
            if (platformStats[platformName]) {
              platformStats[platformName].posts++;
              
              if (platform.analytics) {
                platformStats[platformName].views += platform.analytics.views || 0;
                platformStats[platformName].likes += platform.analytics.likes || 0;
                platformStats[platformName].comments += platform.analytics.comments || 0;
                platformStats[platformName].shares += platform.analytics.shares || 0;
              }
            }
          }
        });
      }
    });

    // Агрегированная статистика
    const totalViews = Object.values(platformStats).reduce((sum, p) => sum + p.views, 0);
    const totalLikes = Object.values(platformStats).reduce((sum, p) => sum + p.likes, 0);
    const totalComments = Object.values(platformStats).reduce((sum, p) => sum + p.comments, 0);
    const totalShares = Object.values(platformStats).reduce((sum, p) => sum + p.shares, 0);
    
    const engagementRate = totalViews > 0 
      ? Math.round(((totalLikes + totalComments + totalShares) / totalViews) * 100)
      : 0;

    const analyticsData = {
      success: true,
      period,
      totalPosts,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      engagementRate,
      platforms: Object.entries(platformStats).map(([name, stats]) => ({
        name,
        posts: stats.posts,
        views: stats.views,
        likes: stats.likes,
        comments: stats.comments,
        shares: stats.shares
      })).filter(p => p.posts > 0)
    };

    console.log('[Analytics Server] ✅ Отправляем данные:', analyticsData);
    res.json(analyticsData);

  } catch (error) {
    console.error('[Analytics Server] ❌ Ошибка:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch analytics data',
      details: error.message 
    });
  }
});

const PORT = 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Analytics Server] 🚀 Сервер аналитики запущен на порту ${PORT}`);
});