import { Express, Request, Response } from 'express';
import axios from 'axios';
import { authenticateUser } from './middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from './services/campaign-access';

export function registerSimpleAnalyticsAPI(app: Express) {
  console.log('[Simple Analytics] 🚀 Регистрируем API эндпоинт /server-api/analytics');

  // authenticateUser нужен явно: путь начинается с /server-api, то есть не попадает
  // даже под гейт /api. Раньше здесь хватало любого заголовка Authorization, и
  // ручка отдавала настоящий контент ЛЮБОЙ кампании (находка ревью 2026-07-28).
  app.get('/server-api/analytics', authenticateUser, async (req: Request, res: Response) => {
    console.log('[Simple Analytics] 🎯 МАРШРУТ СРАБОТАЛ! Получен запрос на /server-api/analytics');
    
    try {
      const { campaignId, period = '7days' } = req.query;
      
      console.log(`[Simple Analytics] 📋 Параметры: campaignId=${campaignId}, period=${period}`);

      if (!campaignId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Параметр campaignId обязателен' 
        });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        console.log(`[Simple Analytics] Нет токена авторизации`);
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }

      // Доступ к кампании проверяем явно: фильтр по campaign_id сам по себе
      // ничего не ограничивает — id чужой кампании отдал бы чужой контент.
      try {
        await authorizeCampaignAccess(
          String(campaignId),
          (req as any).user?.id,
          (req as any).user?.token || '',
          (req as any).user?.is_smm_admin === true,
        );
      } catch (accessErr: any) {
        if (accessErr instanceof CampaignAccessError && accessErr.status === 503) {
          return res.status(503).json({ success: false, error: 'Проверка доступа временно недоступна' });
        }
        // 404, а не 403: не подтверждаем существование чужой кампании.
        return res.status(404).json({ success: false, error: 'Кампания не найдена' });
      }

      const token = authHeader.replace('Bearer ', '');
      const days = period === '30days' ? 30 : 7;

      console.log(`[Simple Analytics] Делаем запрос к Directus для кампании ${campaignId}, период: ${days} дней`);

      try {
        // Прямой запрос к Directus API
        const directusUrl = `${process.env.DIRECTUS_URL}/items/campaign_content`;
        const response = await axios.get(directusUrl, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            'filter[campaign_id][_eq]': campaignId,
            'filter[status][_eq]': 'published',
            'filter[published_at][_gte]': `$NOW(-${days} days)`,
            'fields': ['id', 'title', 'social_platforms', 'published_at'],
            'limit': 1000
          }
        });

        console.log(`[Simple Analytics] Получен ответ от Directus:`, response.data.data?.length, 'записей');

        const posts = response.data.data || [];
        
        // Подсчитываем статистику согласно ТЗ
        let totalPosts = 0;
        let totalViews = 0;
        let totalLikes = 0;
        let totalShares = 0;
        let totalComments = 0;
        
        const platformStats = new Map<string, any>();
        
        posts.forEach((post: any) => {
          if (post.social_platforms) {
            Object.values(post.social_platforms).forEach((platform: any) => {
              if (platform && platform.status === 'published') {
                totalPosts++;
                
                const analytics = platform.analytics || {};
                totalViews += analytics.views || 0;
                totalLikes += analytics.likes || 0;
                totalShares += analytics.shares || 0;
                totalComments += analytics.comments || 0;
                
                const platformName = platform.platform || 'unknown';
                if (!platformStats.has(platformName)) {
                  platformStats.set(platformName, {
                    name: platformName,
                    posts: 0,
                    views: 0,
                    likes: 0,
                    shares: 0,
                    comments: 0
                  });
                }
                
                const stats = platformStats.get(platformName);
                stats.posts++;
                stats.views += analytics.views || 0;
                stats.likes += analytics.likes || 0;
                stats.shares += analytics.shares || 0;
                stats.comments += analytics.comments || 0;
              }
            });
          }
        });

        const analyticsData = {
          success: true,
          totalPosts,
          totalViews,
          totalLikes,
          totalShares,
          totalComments,
          platforms: Array.from(platformStats.values())
        };

        console.log(`[Simple Analytics] Отправляем данные:`, analyticsData);
        
        // Обязательно устанавливаем правильные заголовки
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(analyticsData);
        
      } catch (directusError: any) {
        console.error(`[Simple Analytics] Ошибка Directus:`, directusError.message);
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка при получении данных из Directus',
          details: directusError.message 
        });
      }

    } catch (error: any) {
      console.error(`[Simple Analytics] Общая ошибка:`, error);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ 
        success: false, 
        error: 'Ошибка сервера',
        details: error.message 
      });
    }
  });
}