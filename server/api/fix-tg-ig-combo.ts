/**
 * Маршрут для принудительного исправления комбинации TG+IG
 * Исправляет контент со статусом 'scheduled', но с опубликованными платформами в комбинации Telegram + Instagram
 */

import express, { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

router.post('/fix-tg-ig-combo', async (req: Request, res: Response) => {
  try {
    log('Запуск исправления комбинации TG+IG', 'fix-tg-ig');
    
    // Получаем админский токен из запроса или из переменных окружения
    let authToken = req.headers.authorization || req.body.token;
    
    if (!authToken) {
      // Пытаемся получить токен из переменных окружения
      authToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN;
      
      if (!authToken) {
        // Если токен не найден, пытаемся авторизоваться через логин/пароль
        try {
          const directusUrl = process.env.DIRECTUS_URL;
          const loginResponse = await axios.post(`${directusUrl}/auth/login`, {
            email: process.env.DIRECTUS_ADMIN_EMAIL,
            password: process.env.DIRECTUS_ADMIN_PASSWORD
          });
          
          if (loginResponse?.data?.data?.access_token) {
            authToken = loginResponse.data.data.access_token;
            log('Успешная авторизация в Directus', 'fix-tg-ig');
          }
        } catch (error) {
          log(`Ошибка авторизации: ${error}`, 'fix-tg-ig');
        }
      }
    }
    
    if (!authToken) {
      return res.status(401).json({ success: false, error: 'Не удалось получить токен авторизации' });
    }
    
    // Форматируем токен
    if (authToken.startsWith('Bearer ')) {
      authToken = authToken.substring(7);
    }
    
    const directusUrl = process.env.DIRECTUS_URL;
    const headers = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };
    
    // Запрашиваем только контент со статусом 'scheduled'
    const scheduledResponse = await axios.get(`${directusUrl}/items/campaign_content`, {
      headers,
      params: {
        filter: JSON.stringify({
          status: {
            _eq: 'scheduled'
          },
          social_platforms: {
            _nnull: true
          }
        }),
        fields: ['id', 'title', 'status', 'social_platforms', 'published_at'],
        limit: -1 // Получаем все записи
      }
    });
    
    if (!scheduledResponse?.data?.data) {
      return res.status(500).json({ success: false, error: 'Не удалось получить данные контента' });
    }
    
    const scheduledContent = scheduledResponse.data.data;
    log(`Получено ${scheduledContent.length} записей со статусом 'scheduled'`, 'fix-tg-ig');
    
    let updatedCount = 0;
    let tgIgFound = 0;
    let totalChecked = 0;
    
    // Проходим по всему контенту и ищем комбинацию TG+IG
    for (const item of scheduledContent) {
      totalChecked++;
      if (!item.social_platforms) continue;
      
      let platforms = item.social_platforms;
      if (typeof platforms === 'string') {
        try {
          platforms = JSON.parse(platforms);
        } catch (e) {
          continue;
        }
      }
      
      if (Object.keys(platforms).length < 2) continue; // Пропускаем, если меньше 2 платформ
      
      // Проверяем наличие комбинации TG+IG
      let hasTelegram = false;
      let hasInstagram = false;
      let telegramPublished = false;
      let instagramPublished = false;
      let allPlatformsPublished = true;
      const allPlatforms = Object.keys(platforms);
      
      // Проверяем все платформы в JSON
      for (const platform of allPlatforms) {
        const data = platforms[platform] || {};
        const status = data.status;
        
        if (platform === 'telegram') {
          hasTelegram = true;
          telegramPublished = (status === 'published');
        } else if (platform === 'instagram') {
          hasInstagram = true;
          instagramPublished = (status === 'published');
        }
        
        // Если хотя бы одна платформа не опубликована, меняем флаг
        if (status !== 'published') {
          allPlatformsPublished = false;
        }
      }
      
      // Если это комбинация TG+IG и все платформы опубликованы
      const isTgIgCombo = hasTelegram && hasInstagram && 
                       allPlatforms.length === 2 && 
                       telegramPublished && instagramPublished;
      
      if (isTgIgCombo) {
        tgIgFound++;
        log(`Найдена комбинация TG+IG: ${item.id}, все платформы опубликованы: ${allPlatformsPublished}`, 'fix-tg-ig');
        
        if (allPlatformsPublished) {
          try {
            log(`Обновление статуса контента ${item.id} на 'published'`, 'fix-tg-ig');
            
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
            log(`Успешно обновлен статус контента ${item.id}`, 'fix-tg-ig');
          } catch (error) {
            log(`Ошибка при обновлении статуса контента ${item.id}: ${error}`, 'fix-tg-ig');
          }
        }
      }
    }
    
    return res.json({
      success: true,
      message: `Проверено ${totalChecked} контентов, найдено комбинаций TG+IG: ${tgIgFound}, обновлено: ${updatedCount}`,
      data: {
        checked: totalChecked,
        tgIgFound,
        updated: updatedCount
      }
    });
    
  } catch (error) {
    log(`Ошибка при исправлении TG+IG: ${error}`, 'fix-tg-ig');
    return res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

export default router;
