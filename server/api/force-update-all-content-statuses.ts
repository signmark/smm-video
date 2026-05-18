/**
 * Маршрут для принудительной проверки и обновления всех статусов контента
 * Проверяет ВЕСЬ контент в базе данных на наличие платформ с опубликованными статусами
 * Специально обрабатывает случай с TG+IG
 */

import express, { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { DirectusAuthManager } from '../services/directus-auth';

const router = express.Router();

router.post('/force-update-all-content-statuses', async (req: Request, res: Response) => {
  try {
    log('Запрос на принудительное обновление всех статусов контента', 'force-update');
    
    // Получаем админский токен
    const adminToken = await DirectusAuthManager.getAdminToken();
    if (!adminToken) {
      log('Ошибка: не удалось получить админский токен', 'force-update');
      return res.status(500).json({ success: false, error: 'Не удалось получить админский токен' });
    }
    
    const directusUrl = process.env.DIRECTUS_URL;
    const headers = {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    };
    
    // Запрос на получение ВСЕГО контента (независимо от статуса)
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content`, {
      headers,
      params: {
        fields: ['id', 'title', 'status', 'social_platforms', 'published_at'],
        limit: -1
      }
    });
    
    if (!contentResponse?.data?.data) {
      log('Ошибка: не удалось получить данные контента', 'force-update');
      return res.status(500).json({ success: false, error: 'Не удалось получить данные контента' });
    }
    
    const allContent = contentResponse.data.data;
    log(`Получено ${allContent.length} контентов для проверки`, 'force-update');
    
    let updatedCount = 0;
    let tgIgCount = 0;
    
    // Проходимся по всему контенту
    for (const item of allContent) {
      // Проверяем только если есть платформы
      if (!item.social_platforms) continue;
      
      let platforms = item.social_platforms;
      if (typeof platforms === 'string') {
        try {
          platforms = JSON.parse(platforms);
        } catch (e) {
          log(`Ошибка парсинга JSON для контента ${item.id}: ${e}`, 'force-update');
          continue;
        }
      }
      
      // Пропускаем, если платформ нет
      if (Object.keys(platforms).length === 0) continue;
      
      // Проверяем статусы платформ
      const allPlatforms = Object.keys(platforms);
      const publishedPlatforms = [];
      
      // Счетчики для специальной проверки TG+IG
      let hasTelegram = false;
      let hasInstagram = false;
      let telegramPublished = false;
      let instagramPublished = false;
      
      for (const platform of allPlatforms) {
        const data = platforms[platform] || {};
        const status = data.status;
        
        // Отслеживаем TG+IG
        if (platform === 'telegram') {
          hasTelegram = true;
          telegramPublished = (status === 'published');
        } else if (platform === 'instagram') {
          hasInstagram = true;
          instagramPublished = (status === 'published');
        }
        
        if (status === 'published') {
          publishedPlatforms.push(platform);
        }
      }
      
      // Проверка на все опубликованные платформы
      const allPublished = allPlatforms.length > 0 && allPlatforms.length === publishedPlatforms.length;
      
      // Специальная проверка для TG+IG
      const isTelegramInstagramCombo = hasTelegram && hasInstagram && allPlatforms.length === 2 && 
                                      telegramPublished && instagramPublished && item.status === 'scheduled';
      
      // Если нашли TG+IG комбинацию, логируем
      if (isTelegramInstagramCombo) {
        log(`ОБНАРУЖЕНА ПРОБЛЕМНАЯ КОМБИНАЦИЯ TG+IG: ${item.id} (${item.title || 'Без названия'})`, 'force-update');
        tgIgCount++;
      }
      
      // Обновляем статус, если все платформы опубликованы или если это TG+IG
      if ((allPublished || isTelegramInstagramCombo) && item.status !== 'published') {
        try {
          log(`Обновление статуса контента ${item.id} на 'published'`, 'force-update');
          
          const updateData: any = { status: 'published' };
          if (!item.published_at) {
            updateData.published_at = new Date().toISOString();
          }
          
          await axios.patch(
            `${directusUrl}/items/campaign_content/${item.id}`,
            updateData,
            { headers }
          );
          
          updatedCount++;
          
          if (isTelegramInstagramCombo) {
            log(`Успешно обновлен статус для проблемной комбинации TG+IG: ${item.id}`, 'force-update');
          }
        } catch (error) {
          log(`Ошибка при обновлении статуса контента ${item.id}: ${error}`, 'force-update');
        }
      }
    }
    
    return res.json({
      success: true,
      message: `Проверено ${allContent.length} контентов, обновлено ${updatedCount}, найдено TG+IG комбинаций: ${tgIgCount}`
    });
    
  } catch (error) {
    log(`Ошибка при выполнении запроса: ${error}`, 'force-update');
    return res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

export default router;