import { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

/**
 * Маршрут для принудительной проверки и обновления статуса контента
 * Используется для диагностики и исправления проблем с обновлением статусов
 */
export default function registerForceCheckRoute(app: any) {
  app.get('/api/force-check-content-status/:contentId', async (req: Request, res: Response) => {
    const contentId = req.params.contentId;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Content ID is required' });
    }
    
    try {
      log(`Принудительная проверка статуса контента ${contentId}`, 'force-check');
      
      // Получаем токен администратора
      const directusUrl = process.env.DIRECTUS_URL;
      const email = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@nplanner.ru';
      const password = process.env.DIRECTUS_ADMIN_PASSWORD || 'password';
      
      // Авторизация в Directus
      const authResponse = await axios.post(`${directusUrl}/auth/login`, {
        email,
        password
      });
      
      const authToken = authResponse.data.data.access_token;
      
      // Получаем данные контента
      const contentResponse = await axios.get(
        `${directusUrl}/items/campaign_content/${contentId}`,
        { headers: { 'Authorization': `Bearer ${authToken}` } }
      );
      
      const content = contentResponse.data.data;
      
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }
      
      // Проверяем статусы всех платформ
      const platforms = typeof content.social_platforms === 'string' ? 
        JSON.parse(content.social_platforms) : content.social_platforms;
      
      if (!platforms || typeof platforms !== 'object') {
        return res.status(400).json({ error: 'Invalid social platforms data' });
      }
      
      // Анализируем статусы платформ
      const allPlatforms = Object.keys(platforms);
      const publishedPlatforms = [];
      const pendingPlatforms = [];
      const errorPlatforms = [];
      
      for (const [platform, data] of Object.entries(platforms)) {
        const status = (data as Record<string, unknown>).status;
        
        if (status === 'published') {
          publishedPlatforms.push(platform);
        } else if (status === 'pending' || status === 'scheduled') {
          pendingPlatforms.push(platform);
        } else if (status === 'error') {
          errorPlatforms.push(platform);
        }
      }
      
      // Логируем результаты проверки
      log(`Контент ${contentId}: Всего платформ: ${allPlatforms.length}`, 'force-check');
      log(`Опубликовано: ${publishedPlatforms.length}, В ожидании: ${pendingPlatforms.length}, Ошибки: ${errorPlatforms.length}`, 'force-check');
      
      // Проверяем, все ли платформы опубликованы
      const allPublished = allPlatforms.length === publishedPlatforms.length;
      
      // Обновляем статус, если все платформы опубликованы
      if (allPublished && allPlatforms.length > 0) {
        log(`Все платформы опубликованы, обновляем статус контента ${contentId} на published`, 'force-check');
        
        await axios.patch(
          `${directusUrl}/items/campaign_content/${contentId}`,
          { 
            status: 'published',
            published_at: new Date().toISOString()
          },
          { headers: { 'Authorization': `Bearer ${authToken}` } }
        );
        
        return res.json({
          success: true,
          message: 'Content status updated to published',
          details: {
            contentId,
            allPlatforms,
            publishedPlatforms,
            pendingPlatforms,
            errorPlatforms,
            statusUpdated: true
          }
        });
      } else {
        return res.json({
          success: true,
          message: 'Content status check completed, no update needed',
          details: {
            contentId,
            currentStatus: content.status,
            allPlatforms,
            publishedPlatforms,
            pendingPlatforms,
            errorPlatforms,
            statusUpdated: false
          }
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      log(`Ошибка при проверке статуса контента ${contentId}: ${message}`, 'force-check');
      return res.status(500).json({ 
        error: 'Error checking content status', 
        message,
        stack: process.env.NODE_ENV === 'production' ? undefined : stack
      });
    }
  });
}
