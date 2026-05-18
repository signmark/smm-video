/**
 * API маршруты для принудительного обновления статуса контента
 * Позволяет проверить все выбранные платформы и обновить общий статус
 */

import { Router } from 'express';
import { directusApi } from '../directus';
import axios from 'axios';
import { log } from '../utils/logger';
import { SocialPlatform } from '@shared/schema';

export const forceUpdateStatusRouter = Router();

/**
 * Маршрут для принудительного обновления статуса контента
 * Проверяет все выбранные платформы и, если все имеют статус "published",
 * устанавливает общий статус контента в "published"
 */
forceUpdateStatusRouter.post('/publish/force-update-status/:contentId', async (req, res) => {
  const contentId = req.params.contentId;
  const operationId = `force_update_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  log.info(`[${operationId}] Принудительное обновление статуса для контента ${contentId}`);
  
  try {
    // Получаем API URL системы
    const directusUrl = process.env.DIRECTUS_URL;
    
    // Получаем токен из заголовка Authorization или из переменных окружения
    const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
    let token = process.env.DIRECTUS_ADMIN_TOKEN || '';
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // Если токен не указан в заголовке, пробуем получить из активных сессий
      const sessions = directusAuthManager.getAllActiveSessions();
      
      if (sessions.length > 0) {
        // Берем самый свежий токен из активных сессий
        token = sessions[0].token;
        log.info(`[${operationId}] Используем токен из активных сессий`);
      } else if (!token) {
        log.error(`[${operationId}] Не найден токен авторизации`);
        return res.status(401).json({ 
          success: false, 
          error: 'Не найден токен авторизации' 
        });
      }
    }
    
    // 1. Получаем текущие данные контента
    log.info(`[${operationId}] Получение данных контента ${contentId}`);
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!contentResponse.data?.data) {
      throw new Error(`Контент с ID ${contentId} не найден`);
    }
    
    const content = contentResponse.data.data;
    log.info(`[${operationId}] Контент получен: ${content.id}, от user_id: ${content.user_id}`);
    
    // 2. Обрабатываем текущее значение social_platforms
    let socialPlatforms = content.social_platforms || {};
    
    // Если socialPlatforms - строка, парсим JSON
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (e) {
        log.error(`[${operationId}] Ошибка парсинга social_platforms: ${e}`);
        socialPlatforms = {};
      }
    }
    
    // ВАЖНО: Если socialPlatforms не объект, создаем новый
    if (typeof socialPlatforms !== 'object' || !socialPlatforms) {
      socialPlatforms = {};
    }
    
    const platforms = Object.keys(socialPlatforms);
    log.info(`[${operationId}] Найдено платформ: ${platforms.length}`);
    
    if (platforms.length === 0) {
      return res.json({
        success: false,
        message: 'Нет выбранных социальных платформ для контента',
        content: content,
        needsUpdate: false
      });
    }
    
    // 3. Проверяем статусы всех платформ
    let allPublished = true;
    let allSelected = true; // Все выбранные платформы должны быть опубликованы
    let publishedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let selectedCount = 0;
    let platformsStatus = [];
    
    for (const platform of platforms) {
      const platformData = socialPlatforms[platform] || {};
      // Проверяем, что платформа выбрана для публикации
      if (platformData.selected) {
        selectedCount++;
        const status = platformData.status || 'pending';
        platformsStatus.push({ 
          platform, 
          status,
          postUrl: platformData.postUrl || null,
          error: platformData.error || null
        });
        
        if (status === 'published') {
          publishedCount++;
        } else if (status === 'failed') {
          failedCount++;
          allPublished = false;
        } else {
          pendingCount++;
          allPublished = false;
        }
      }
    }
    
    // Если нет выбранных платформ, не считаем все опубликованными
    if (selectedCount === 0) {
      allPublished = false;
    }
    
    // Проверяем, что все выбранные платформы опубликованы
    allSelected = (selectedCount > 0) && (publishedCount === selectedCount);
    
    log.info(`[${operationId}] Статус публикаций: published=${publishedCount}, pending=${pendingCount}, failed=${failedCount}`);
    
    // 4. Если все выбранные платформы опубликованы, обновляем статус контента
    if (allSelected && publishedCount > 0) {
      log.info(`[${operationId}] Все выбранные платформы опубликованы (${publishedCount}/${selectedCount}), обновляем статус контента на published`);
      
      // Обновляем статус контента
      await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
        status: 'published',
        published_at: new Date().toISOString()
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      return res.json({
        success: true,
        message: `Статус контента успешно обновлен на "published". Все выбранные платформы (${publishedCount}/${selectedCount}) опубликованы.`,
        status: 'published',
        platformsStatus
      });
    } else if (failedCount > 0 && pendingCount === 0) {
      // Если есть ошибки и нет ожидающих публикаций, устанавливаем статус "failed"
      log.info(`[${operationId}] Имеются ошибки публикации, обновляем статус контента на "failed"`);
      
      // Обновляем статус контента
      await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
        status: 'failed'
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      return res.json({
        success: true,
        message: `Статус контента успешно обновлен на "failed". Ошибок публикации: ${failedCount}/${selectedCount}`,
        status: 'failed',
        platformsStatus
      });
    } else {
      // Если есть ожидающие публикации, оставляем статус без изменений
      log.info(`[${operationId}] Есть ожидающие публикации, статус контента остается без изменений`);
      
      return res.json({
        success: true,
        message: `Статус контента остается без изменений. Опубликовано: ${publishedCount}/${selectedCount}, в очереди: ${pendingCount}, ошибок: ${failedCount}`,
        status: content.status,
        platformsStatus
      });
    }
    
  } catch (error: any) {
    log.error(`[${operationId}] Ошибка при обновлении статуса: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[${operationId}] Детали ошибки API: ${JSON.stringify(error.response.data)}`);
    }
    
    return res.status(500).json({
      success: false,
      error: `Ошибка при обновлении статуса контента: ${error.message}`
    });
  }
});

/**
 * Получает текущий статус публикаций для контента
 */
forceUpdateStatusRouter.get('/publish/content-status/:contentId', async (req, res) => {
  const contentId = req.params.contentId;
  const operationId = `status_check_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  log.info(`[${operationId}] Проверка статуса публикаций для контента ${contentId}`);
  
  try {
    // Получаем API URL системы
    const directusUrl = process.env.DIRECTUS_URL;
    
    // Получаем токен из заголовка Authorization или из переменных окружения
    const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
    let token = process.env.DIRECTUS_ADMIN_TOKEN || '';
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // Если токен не указан в заголовке, пробуем получить из активных сессий
      const sessions = directusAuthManager.getAllActiveSessions();
      
      if (sessions.length > 0) {
        // Берем самый свежий токен из активных сессий
        token = sessions[0].token;
        log.info(`[${operationId}] Используем токен из активных сессий`);
      } else if (!token) {
        log.error(`[${operationId}] Не найден токен авторизации`);
        return res.status(401).json({ 
          success: false, 
          error: 'Не найден токен авторизации' 
        });
      }
    }
    
    // Получаем данные контента
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!contentResponse.data?.data) {
      throw new Error(`Контент с ID ${contentId} не найден`);
    }
    
    const content = contentResponse.data.data;
    log.info(`[${operationId}] Контент получен: ${content.id}, статус: ${content.status || 'draft'}`);
    
    // Обрабатываем текущее значение social_platforms
    let socialPlatforms = content.social_platforms || {};
    
    // Если socialPlatforms - строка, парсим JSON
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (e) {
        log.error(`[${operationId}] Ошибка парсинга social_platforms: ${e}`);
        socialPlatforms = {};
      }
    }
    
    // ВАЖНО: Если socialPlatforms не объект, создаем новый
    if (typeof socialPlatforms !== 'object' || !socialPlatforms) {
      socialPlatforms = {};
    }
    
    const platforms = Object.keys(socialPlatforms);
    const platformsStatus = [];
    
    for (const platform of platforms) {
      const platformData = socialPlatforms[platform] || {};
      if (platformData.selected) {
        platformsStatus.push({
          platform,
          status: platformData.status || 'pending',
          postUrl: platformData.postUrl || null,
          publishedAt: platformData.publishedAt || null,
          error: platformData.error || null
        });
      }
    }
    
    return res.json({
      success: true,
      contentStatus: content.status || 'draft',
      platforms: platformsStatus,
      content: {
        id: content.id,
        title: content.title,
        status: content.status,
        content: content.content,
        imageUrl: content.image_url,
        createdAt: content.date_created
      }
    });
    
  } catch (error: any) {
    log.error(`[${operationId}] Ошибка при получении статуса: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[${operationId}] Детали ошибки API: ${JSON.stringify(error.response.data)}`);
    }
    
    return res.status(500).json({
      success: false,
      error: `Ошибка при получении статуса контента: ${error.message}`
    });
  }
});
