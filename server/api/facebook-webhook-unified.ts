/**
 * Унифицированный вебхук для Facebook
 * Объединяет весь функционал разных версий в одном файле
 */

import { Router } from 'express';
import axios from 'axios';
import log from '../utils/logger';
import { facebookService } from '../services/social-platforms/facebook-service';

const router = Router();

// Основной маршрут для публикации контента в Facebook
router.post('/', async (req, res) => {
  let postUrl = '';
  let postId = '';
  
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID контента для публикации в Facebook' 
      });
    }
    
    log.info(`[Facebook] Начало публикации контента ${contentId} в Facebook`);
    
    // Получаем данные контента из Directus
    // Получаем токен из активных сессий администратора
    const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
    
    // Получаем токен из активных сессий администратора или используем токен из переменных окружения
    let adminToken = process.env.DIRECTUS_ADMIN_TOKEN || '';
    const sessions = directusAuthManager.getAllActiveSessions();
    
    if (sessions.length > 0) {
      // Берем самый свежий токен из активных сессий
      adminToken = sessions[0].token;
      log.info(`[Facebook] Используем токен из активных сессий`);
    } else if (!adminToken) {
      log.error(`[Facebook] Не найден токен администратора`);
      return res.status(500).json({ 
        success: false,
        error: 'Ошибка авторизации: токен администратора не найден' 
      });
    }
    
    // Получаем данные контента с помощью adminToken
    const directusUrl = process.env.DIRECTUS_URL;
    const directusApi = axios.create({
      baseURL: directusUrl
    });
    
    log.info(`[Facebook] Получение данных контента ${contentId}`);
    
    const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (!contentResponse.data?.data) {
      log.error(`[Facebook] Контент с ID ${contentId} не найден`);
      return res.status(404).json({ 
        success: false,
        error: 'Контент не найден' 
      });
    }
    
    const content = contentResponse.data.data;
    
    if (!content.campaign_id) {
      log.error(`[Facebook] Контент ${contentId} не привязан к кампании`);
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID кампании в контенте' 
      });
    }
    
    // Получаем данные кампании для извлечения настроек Facebook
    const campaignResponse = await directusApi.get(`/items/user_campaigns/${content.campaign_id}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (!campaignResponse.data?.data) {
      log.error(`[Facebook] Кампания с ID ${content.campaign_id} не найдена`);
      return res.status(400).json({ 
        success: false,
        error: 'Кампания не найдена' 
      });
    }
    
    const campaign = campaignResponse.data.data;
    log.info(`[Facebook] Получены данные кампании: "${campaign.name}"`);
    
    // Извлекаем настройки Facebook из кампании
    let socialSettings = campaign.social_media_settings || {};
    
    // Если socialSettings - строка, парсим JSON
    if (typeof socialSettings === 'string') {
      try {
        socialSettings = JSON.parse(socialSettings);
      } catch (e) {
        socialSettings = {};
      }
    }
    
    const facebookSettings = socialSettings.facebook || {};
    
    const facebookAccessToken = facebookSettings.token;
    const facebookPageId = facebookSettings.pageId;
    
    if (!facebookAccessToken || !facebookPageId) {
      log.error('[Facebook] Отсутствуют обязательные параметры Facebook (token или pageId)');
      return res.status(400).json({ 
        success: false,
        error: 'Отсутствуют настройки для Facebook (token или pageId)' 
      });
    }
    
    // Конвертируем данные контента в формат, понятный сервису
    // Требуемые поля для типа CampaignContent из shared/schema.ts
    const campaignContent = {
      id: content.id,
      userId: content.user_id,
      campaignId: content.campaign_id,
      content: content.content,
      contentType: content.content_type || 'text',
      title: content.title,
      imageUrl: content.image_url,
      socialPlatforms: content.social_platforms,
      // Добавляем все обязательные поля для типа CampaignContent
      createdAt: content.date_created ? new Date(content.date_created) : new Date(),
      keywords: content.keywords || [],
      additionalImages: content.additional_images || [],
      videoUrl: content.video_url || null,
      additionalMedia: content.additional_media || [],
      status: content.status || 'draft',
      scheduledAt: content.scheduled_at ? new Date(content.scheduled_at) : null,
      tags: content.tags || [],
      author: content.author || null,
      metadata: content.metadata || {},
      // Добавляем недостающие поля, которые требуются по схеме
      prompt: content.prompt || '',
      hashtags: content.hashtags || [],
      links: content.links || [],
      publishedAt: content.published_at ? new Date(content.published_at) : null
    };
    
    // Публикуем контент с помощью сервиса Facebook
    const publicationResult = await facebookService.publishToFacebook(
      campaignContent,
      { token: facebookAccessToken, pageId: facebookPageId }
    );
    
    // В любом случае обновляем статус в базе данных - независимо от результата
    log.info(`[Facebook] Получен результат публикации: status=${publicationResult.status}, postUrl=${publicationResult.postUrl || 'нет'}`);
    
    try {
      // Обновляем статус публикации в базе данных
      const updatedContent = await facebookService.updatePublicationStatus(
        contentId,
        'facebook',
        publicationResult
      );
      
      log.info(`[Facebook] Статус публикации в базе данных обновлен: ${updatedContent ? 'успешно' : 'сбой при обновлении'}`);
    } catch (error: any) {
      // Если произошла ошибка при обновлении статуса, логируем её, но не прерываем выполнение
      log.error(`[Facebook] Ошибка при обновлении статуса в базе: ${error.message || 'неизвестная ошибка'}`);
      // Продолжаем выполнение - важно вернуть результат публикации клиенту
    }
    
    if (publicationResult.status === 'published') {
      postUrl = publicationResult.postUrl || '';
      postId = publicationResult.postId || '';
      
      log.info(`[Facebook] Публикация успешно создана: ${postUrl}`);
      
      return res.json({
        success: true,
        message: 'Публикация в Facebook успешно создана',
        postUrl,
        postId
      });
    } else {
      // В случае ошибки публикации возвращаем ошибку, но статус уже обновлен
      return res.status(500).json({
        success: false,
        error: publicationResult.error || 'Неизвестная ошибка публикации',
        status: 'failed'
      });
    }
  } catch (error: any) {
    log.error(`[Facebook] Ошибка: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook] Детали ошибки API: ${JSON.stringify(error.response.data)}`);
    }
    
    return res.status(500).json({
      success: false,
      error: `Ошибка публикации: ${error.message}`
    });
  }
});

// Маршрут для обновления статуса публикации
router.post('/update-status', async (req, res) => {
  try {
    const { contentId, status, postUrl, postId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID контента' 
      });
    }
    
    log.info(`[Facebook] Обновление статуса публикации для контента ${contentId}: ${status}`);
    
    // Формируем объект с результатом публикации
    const publicationResult = {
      platform: 'facebook' as const,
      status: status || 'published',
      publishedAt: new Date(),
      postUrl: postUrl || '',
      postId: postId || '',
    };
    
    // Обновляем статус публикации с помощью сервиса
    const updatedContent = await facebookService.updatePublicationStatus(
      contentId,
      'facebook',
      publicationResult
    );
    
    if (updatedContent) {
      return res.json({
        success: true,
        message: 'Статус публикации успешно обновлен',
        content: updatedContent
      });
    } else {
      throw new Error('Не удалось обновить статус публикации');
    }
  } catch (error: any) {
    log.error(`[Facebook] Ошибка при обновлении статуса: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Ошибка обновления статуса: ${error.message}`
    });
  }
});

// Маршрут для получения токена конкретной страницы
router.get('/page-token/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const { token } = req.query;
    
    if (!token || !pageId) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан токен пользователя или ID страницы' 
      });
    }
    
    log.info(`[Facebook] Получение токена для страницы ${pageId}`);
    
    // Получаем список страниц с их токенами
    const apiVersion = 'v19.0';
    const pagesUrl = `https://graph.facebook.com/${apiVersion}/me/accounts`;
    
    const pagesResponse = await axios.get(pagesUrl, {
      params: { access_token: token }
    });
    
    if (!pagesResponse.data?.data) {
      throw new Error('Не удалось получить список страниц');
    }
    
    const pages = pagesResponse.data.data || [];
    const targetPage = pages.find((page: any) => page.id === pageId);
    
    if (!targetPage) {
      return res.status(404).json({
        success: false,
        error: `Страница с ID ${pageId} не найдена или нет доступа к ней`
      });
    }
    
    log.info(`[Facebook] Токен страницы ${targetPage.name} успешно получен`);
    
    return res.json({
      success: true,
      message: `Токен страницы "${targetPage.name}" получен`,
      page: {
        id: targetPage.id,
        name: targetPage.name,
        category: targetPage.category,
        access_token: targetPage.access_token,
      }
    });
  } catch (error: any) {
    log.error(`[Facebook] Ошибка при получении токена страницы: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Ошибка получения токена страницы: ${error.message}`
    });
  }
});

// Маршрут для тестирования токена и получения доступных страниц
router.post('/test-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан токен Facebook' 
      });
    }
    
    log.info(`[Facebook] Тестирование токена: ${token.substring(0, 10)}...`);
    
    // Получаем список страниц
    const apiVersion = 'v19.0'; // Последняя версия API
    const pagesUrl = `https://graph.facebook.com/${apiVersion}/me/accounts`;
    
    const pagesResponse = await axios.get(pagesUrl, {
      params: { access_token: token }
    });
    
    if (!pagesResponse.data?.data) {
      throw new Error('Не удалось получить список страниц');
    }
    
    const pages = pagesResponse.data.data || [];
    
    log.info(`[Facebook] Получены страницы: ${pages.length}`);
    
    return res.json({
      success: true,
      message: `Найдено ${pages.length} страниц`,
      pages: pages.map((page: any) => ({
        id: page.id,
        name: page.name,
        category: page.category,
        accessToken: page.access_token,
      }))
    });
  } catch (error: any) {
    log.error(`[Facebook] Ошибка при тестировании токена: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Ошибка тестирования токена: ${error.message}`
    });
  }
});

export default router;