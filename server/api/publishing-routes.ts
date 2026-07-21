import { Express, Request, Response } from 'express';
import axios from 'axios';
import { storage } from '../storage';
import { socialPublishingService } from '../services/social/index';
import { authenticateUser } from '../middleware/user-auth';

// Не используем старый сервис, заменив его на новый модульный
import { getPublishScheduler } from '../services/publish-scheduler';
import { getCanonicalScheduledAt } from '@shared/schedule-time';
// Определяем тип SocialPlatform локально
type SocialPlatform = 'instagram' | 'facebook' | 'telegram' | 'vk' | 'youtube';
import { log } from '../utils/logger';
import { invalidateContentCache } from '../utils/content-cache';
import { directusApiManager } from '../directus';
import { directusStorageAdapter } from '../services/directus';
import { generateStoriesImageServer } from '../services/stories-image-generator';

// Upload image to Cloudinary for Stories (Meta-accessible CDN)
async function uploadStoriesImageToCloudinary(imageBuffer: Buffer, filename: string): Promise<string> {
  const base64Image = imageBuffer.toString('base64');
  const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
  const cloudinaryUploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';
  
  const cloudinaryFormData = new FormData();
  cloudinaryFormData.append('file', `data:image/jpeg;base64,${base64Image}`);
  cloudinaryFormData.append('upload_preset', cloudinaryUploadPreset);
  cloudinaryFormData.append('folder', 'instagram-stories');
  
  const cloudinaryResponse = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
    cloudinaryFormData,
    { timeout: 20000 }
  );
  
  if (cloudinaryResponse.data.secure_url) {
    log(`[stories-image] Uploaded to Cloudinary: ${cloudinaryResponse.data.secure_url}`, 'api');
    return cloudinaryResponse.data.secure_url;
  }
  
  throw new Error('Failed to upload image to Cloudinary');
}

// Generate story image with text overlays
async function generateStoryImageWithText(content: any): Promise<string | null> {
  try {
    // Check if this is a story content type
    if (content.content_type !== 'story') {
      return null;
    }
    
    // Extract textOverlays from metadata
    let textOverlays: any[] = [];
    if (content.metadata) {
      const meta = typeof content.metadata === 'string' 
        ? JSON.parse(content.metadata) 
        : content.metadata;
      textOverlays = meta.textOverlays || [];
    }
    
    // Get background image URL
    let backgroundUrl = content.image_url;
    if (!backgroundUrl && content.additional_media) {
      const additionalMedia = typeof content.additional_media === 'string'
        ? JSON.parse(content.additional_media)
        : content.additional_media;
      if (Array.isArray(additionalMedia) && additionalMedia.length > 0) {
        backgroundUrl = additionalMedia[0].url || additionalMedia[0];
      }
    }
    
    if (!backgroundUrl) {
      log('[stories-image] No background image found for story', 'api');
      return null;
    }
    
    log(`[stories-image] Background URL: ${backgroundUrl}`, 'api');
    log(`[stories-image] Text overlays count: ${textOverlays.length}`, 'api');
    
    if (textOverlays.length > 0) {
      log('[stories-image] Generating image with text overlays...', 'api');
      
      const imageBuffer = await generateStoriesImageServer({
        backgroundUrl: backgroundUrl,
        textOverlays: textOverlays,
        width: 1080,
        height: 1920
      });
      
      log('[stories-image] Image generated, uploading to Cloudinary...', 'api');
      
      const generatedUrl = await uploadStoriesImageToCloudinary(
        imageBuffer, 
        `story-${content.id}-${Date.now()}.jpg`
      );
      
      log(`[stories-image] Generated image uploaded: ${generatedUrl}`, 'api');
      return generatedUrl;
    } else {
      // No text overlays, but still need to upload to Cloudinary for Instagram compatibility
      log('[stories-image] No text overlays, uploading original to Cloudinary...', 'api');
      try {
        const response = await axios.get(backgroundUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);
        const generatedUrl = await uploadStoriesImageToCloudinary(
          imageBuffer,
          `story-bg-${content.id}-${Date.now()}.jpg`
        );
        log(`[stories-image] Original uploaded to Cloudinary: ${generatedUrl}`, 'api');
        return generatedUrl;
      } catch (uploadErr) {
        log(`[stories-image] Error uploading original: ${(uploadErr as Error).message}`, 'api');
        return backgroundUrl; // Return original URL as fallback
      }
    }
  } catch (error) {
    log(`[stories-image] Error generating story image: ${(error as Error).message}`, 'api');
    return null;
  }
}

/**
 * Регистрирует маршруты для управления публикациями
 * @param app Express приложение
 */
export function registerPublishingRoutes(app: Express): void {
  console.log('[publishing-routes] Регистрация маршрутов управления публикациями...');
  
  // Маршрут для ручной публикации YouTube (для тестирования)
  app.post('/api/manual-publish', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId, platform } = req.body;
      
      if (!contentId || !platform) {
        return res.status(400).json({
          success: false,
          message: 'Требуются contentId и platform'
        });
      }

      console.log(`[manual-publish] Ручная публикация ${contentId} в ${platform}`);
      
        if (platform === 'youtube') {
          // Принудительно запустить планировщик для конкретного контента
          const publishScheduler = getPublishScheduler();
          if (publishScheduler) {
            await publishScheduler.checkScheduledContent(contentId);
            
            return res.json({
              success: true,
              message: `Контент успешно отправлен на публикацию`
            });
          } else {
          return res.status(500).json({
            success: false,
            message: 'Планировщик не инициализирован'
          });
        }
      }
      
      res.status(400).json({
        success: false,
        message: `Платформа ${platform} не поддерживается`
      });
      
    } catch (error: any) {
      console.error(`[manual-publish] Ошибка: ${error.message}`);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });
  
  // Тестовый маршрут для прямой YouTube публикации
  app.post('/api/test-youtube-publish', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId, content, youtubeSettings, userId } = req.body;
      
      console.log(`[test-youtube] Тестирование YouTube публикации для ${contentId}`);
      console.log(`[test-youtube] YouTube настройки:`, youtubeSettings ? {
        channelId: youtubeSettings.channelId,
        configured: !!youtubeSettings.configured,
        hasAccessToken: !!youtubeSettings.accessToken,
        hasRefreshToken: !!youtubeSettings.refreshToken
      } : null);
      
      // Импортируем YouTube сервис
      const { YouTubeService } = await import('../services/social-platforms/youtube-service');
      const youtubeService = new YouTubeService();
      
      // Пытаемся опубликовать - передаем настройки в правильном формате
      const contentData = { 
        id: contentId, 
        title: content.title,
        content: content.description,
        video_url: content.videoUrl, // Исправляем имя поля
        keywords: JSON.stringify(content.tags || [])
      };
      
      const result = await youtubeService.publishContent(
        contentData,
        { youtube: youtubeSettings }, // Оборачиваем в структуру campaignSettings
        userId
      );
      
      console.log(`[test-youtube] Результат публикации:`, result);
      
      // Если ошибка аутентификации, это означает что интеграция работает, но нужны новые токены
      if (result.error && result.error.includes('authentication credentials')) {
        return res.json({
          success: true,
          result: {
            success: false,
            error: 'Токены YouTube истекли - нужно переавторизоваться',
            details: 'Интеграция работает корректно, но требуется обновление OAuth токенов'
          },
          integration_status: 'working',
          message: 'YouTube интеграция готова - требуется обновление токенов'
        });
      }
      
      return res.json({
        success: true,
        result: result,
        message: 'YouTube публикация протестирована'
      });
      
    } catch (error: any) {
      console.error(`[test-youtube] Ошибка: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack
      });
    }
  });

  // Прямой роут для тестирования YouTube публикации
  app.post('/api/publish/direct-youtube', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { content, campaignSettings, userId } = req.body;
      
      console.log('🎬 [YouTube] Прямая публикация YouTube для контента:', content.id);
      console.log('📺 [YouTube] Настройки YouTube:', campaignSettings?.youtube ? {
        channelId: campaignSettings.youtube.channelId,
        configured: !!campaignSettings.youtube.configured,
        hasAccessToken: !!campaignSettings.youtube.accessToken,
        hasRefreshToken: !!campaignSettings.youtube.refreshToken
      } : null);
      
      const { YouTubeService } = await import('../services/social-platforms/youtube-service');
      const youtubeService = new YouTubeService();
      
      const result = await youtubeService.publishContent(
        content,
        campaignSettings,
        userId
      );
      
      console.log('📊 [YouTube] Результат публикации:', result);
      res.json(result);
      
    } catch (error: any) {
      console.error('💥 [YouTube] Ошибка прямой публикации:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // Восстановлена проверка запланированных публикаций после исправления критических ошибок
  app.all('/api/publish/check-scheduled', authenticateUser, async (req: Request, res: Response) => {
    try {
      log('Проверка запланированных публикаций восстановлена', 'api');
      
      // Получаем планировщик из глобального экспорта
      const publishScheduler = getPublishScheduler();
      
      if (!publishScheduler) {
        return res.status(500).json({ 
          error: 'Планировщик не инициализирован'
        });
      }
      
      // Выполняем проверку запланированных публикаций
      await publishScheduler.checkScheduledContent();
      
      return res.json({ 
        success: true,
        message: 'Проверка запланированных публикаций выполнена'
      });
    } catch (error: any) {
      log(`Ошибка при проверке запланированных публикаций: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при проверке публикаций',
        details: error.message
      });
    }
  });
  
  // Управление глобальным флагом отключения публикаций
  // Важно: этот маршрут должен быть определен ДО маршрута с параметром :contentId
  app.all('/api/publish/toggle-publishing', authenticateUser, async (req: Request, res: Response) => {
    try {
      const enable = req.query.enable === 'true';
      const publishScheduler = getPublishScheduler();
      
      // Новый планировщик не имеет флага disablePublishing
      // Вместо этого мы просто включаем/выключаем его работу
      if (enable) {
        publishScheduler.start();
        log('Планировщик публикаций ВКЛЮЧЕН. Контент будет публиковаться в соцсети.', 'api');
      } else {
        publishScheduler.stop();
        log('Планировщик публикаций ОТКЛЮЧЕН. Автоматические публикации приостановлены.', 'api');
      }
      
      return res.status(200).json({
        success: true,
        publishing: enable,
        message: enable 
          ? 'Планировщик публикаций включен. Контент будет публиковаться в соцсети.' 
          : 'Планировщик публикаций отключен. Автоматические публикации приостановлены.'
      });
    } catch (error: any) {
      log(`Ошибка при управлении флагом публикаций: ${error.message}`, 'api');
      return res.status(500).json({
        error: 'Ошибка при управлении флагом публикаций',
        message: error.message
      });
    }
  });
  
  // Маршрут для принудительной пометки контента как опубликованного без фактической публикации
  // Важно: этот маршрут должен быть определен ДО маршрута с параметром :contentId
  app.all('/api/publish/mark-as-published/:contentId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const contentId = req.params.contentId;
      log(`Запрос на принудительную пометку контента ${contentId} как опубликованного`, 'api');
      
      // Получаем текущий контент
      const content = await storage.getCampaignContentById(contentId, req.user?.token);
      
      if (!content) {
        return res.status(404).json({
          error: 'Контент не найден',
          message: `Контент с ID ${contentId} не найден`
        });
      }
      
      // Обновляем статус на published без фактической публикации
      await storage.updateCampaignContent(contentId, {
        status: 'published'
      });
      
      // Устанавливаем publishedAt через прямой запрос к API
      try {
        // Получаем системный токен
        const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
        const directusUrl = process.env.DIRECTUS_URL;
        
        // Пробуем получить токен из активных сессий
        const sessions = directusAuthManager.getAllActiveSessions();
        let token = null;
        
        if (sessions.length > 0) {
          token = sessions[0].token;
        }
        
        if (token) {
          await axios.patch(
            `${directusUrl}/items/campaign_content/${contentId}`,
            { published_at: new Date().toISOString() },
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          log(`Установлено поле published_at для контента ${contentId}`, 'api');
        }
      } catch (error: any) {
        log(`Ошибка при установке published_at: ${error.message}`, 'api');
      }
      
      // Новый планировщик автоматически обрабатывает статусы контента
      // поэтому нет необходимости в ручном добавлении в список обработанных
      log(`Контент ${contentId} помечен как опубликованный`, 'api');
      
      return res.status(200).json({
        success: true,
        message: `Контент ${contentId} помечен как опубликованный без фактической публикации`,
        contentId
      });
    } catch (error: any) {
      log(`Ошибка при пометке контента как опубликованного: ${error.message}`, 'api');
      return res.status(500).json({
        error: 'Ошибка при пометке контента как опубликованного',
        message: error.message
      });
    }
  });
  
  // Очистка кэша обработанных ID контента
  // Важно: этот маршрут должен быть определен ДО маршрута с параметром :contentId
  app.all('/api/publish/reset-processed-cache', authenticateUser, async (req: Request, res: Response) => {
    try {
      log('Запрос на очистку кэша обработанных ID контента', 'api');
      
      // Новый планировщик не использует кэш обработанных ID
      // Он работает на основе статусов в базе данных
      const publishScheduler = getPublishScheduler();
      publishScheduler.stop();
      publishScheduler.start();
      
      log('Кэш обработанных ID контента очищен', 'api');
      
      return res.status(200).json({ 
        success: true, 
        message: 'Кэш обработанных ID контента очищен'
      });
    } catch (error: any) {
      log(`Ошибка при очистке кэша обработанных ID: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при очистке кэша обработанных ID',
        message: error.message
      });
    }
  });
  
  // Публикация контента через API для тестирования
  app.post('/api/publish/content', authenticateUser, async (req: Request, res: Response) => {
    return handlePublishContent(req, res);
  });

  // Алиас для фронтенда
  app.post('/api/publish-content', authenticateUser, async (req: Request, res: Response) => {
    return handlePublishContent(req, res);
  });

  async function handlePublishContent(req: Request, res: Response) {
    try {
      log(`Запрос на публикацию контента через API`, 'api');
      
      // Получаем объект контента и список платформ из запроса
      let { content, contentId, platforms, userId, force = false } = req.body;

      const userToken = req.user?.token;
      const currentUserId = req.user?.id;

      // ПРИНУДИТЕЛЬНО: Обновляем токен через менеджер, если это возможно
      let activeToken = userToken;
      try {
        const { directusAuthManager } = await import('../services/directus-auth-manager');
        if (currentUserId) {
          const validToken = await directusAuthManager.getValidToken(currentUserId);
          if (validToken) {
            activeToken = validToken;
            log(`[handlePublishContent] Using refreshed token for user ${currentUserId}`, 'api');
          }
        }
      } catch (e) {
        log(`[handlePublishContent] Failed to refresh token: ${e}`, 'api');
      }

      // Если передан только ID контента, загружаем его из хранилища
      if (!content && contentId) {
        log(`Загрузка контента по ID: ${contentId}`, 'api');
        content = await storage.getCampaignContentById(contentId, activeToken);
      }
      
      if (!content) {
        return res.status(400).json({ error: 'Объект контента не предоставлен' });
      }
      
      // Если userId не передан в теле, но есть в объекте контента, используем его
      if (!userId && content.userId) {
        userId = content.userId;
      }
      
      // Используем userId из аутентификации если он там есть
      if (!userId && currentUserId) {
        userId = currentUserId;
      }
      
      // Обработка двух возможных форматов платформ: массив или объект
      let selectedPlatforms: string[] = [];
      
      if (Array.isArray(platforms)) {
        // Формат массива: ["telegram", "vk"]
        selectedPlatforms = platforms;
      } else if (platforms && typeof platforms === 'object') {
        // Формат объекта: {telegram: true, vk: true, instagram: false}
        selectedPlatforms = Object.entries(platforms)
          .filter(([_, selected]) => selected === true)
          .map(([name]) => name);
      }
      
      // Проверка, что выбрана хотя бы одна платформа
      if (!selectedPlatforms.length) {
        log(`[publishing-routes] Ошибка: не указаны платформы для публикации. Переданные данные: ${JSON.stringify(platforms)}`, 'api');
        return res.status(400).json({ error: 'Не указаны платформы для публикации' });
      }
      
      // 🎯 Фильтруем платформы по совместимости с типом контента
      {
        const { filterCompatiblePlatforms, getIncompatibilityReason } = await import('../utils/content-type-platform-map');
        const contentType: string | undefined = content.content_type || content.contentType;
        if (contentType) {
          const compatible = filterCompatiblePlatforms(selectedPlatforms, contentType);
          const removed = selectedPlatforms.filter((p: string) => !compatible.includes(p));
          if (removed.length > 0) {
            removed.forEach((p: string) => log(`[publishing-routes] ⛔ Платформа "${p}" несовместима с типом контента "${contentType}" — исключена. ${getIncompatibilityReason(p, contentType)}`, 'api'));
          }
          selectedPlatforms = compatible;
          if (selectedPlatforms.length === 0) {
            return res.status(400).json({
              error: `Ни одна из выбранных платформ не поддерживает тип контента "${contentType}". ` +
                removed.map((p: string) => getIncompatibilityReason(p, contentType)).join('; ')
            });
          }
        }
      }

      // Заменяем оригинальные platforms на преобразованный массив, чтобы не менять остальной код
      const platformsArray = selectedPlatforms;
      
      log(`Публикация контента ${content.id || 'без ID'} в платформы: ${JSON.stringify(selectedPlatforms)}`, 'api');
      
      // КРИТИЧЕСКАЯ ЗАЩИТА: Проверяем уже опубликованные платформы
      const alreadyPublishedPlatforms: string[] = [];
      const platformsToPublish: string[] = [];
      
      if (content.socialPlatforms && typeof content.socialPlatforms === 'object') {
        for (const platform of platformsArray) {
          const platformData = content.socialPlatforms[platform];
          
          // Платформа считается уже опубликованной, если есть статус 'published' И postUrl
          if (platformData && platformData.status === 'published' && platformData.postUrl && platformData.postUrl.trim() !== '') {
            alreadyPublishedPlatforms.push(platform);
            log(`БЛОКИРОВКА: Платформа ${platform} уже опубликована (postUrl: ${platformData.postUrl}), пропускаем`, 'api');
          } else {
            platformsToPublish.push(platform);
            
            // Сбрасываем некорректные published статусы без postUrl
            if (platformData && platformData.status === 'published' && (!platformData.postUrl || platformData.postUrl.trim() === '')) {
              log(`ИСПРАВЛЕНИЕ: Сброс некорректного статуса 'published' без postUrl для платформы ${platform} в /api/publish/content`, 'api');
            }
          }
        }
      } else {
        // Если нет данных о платформах, публикуем во все выбранные
        platformsToPublish.push(...platformsArray);
      }

      // Если все выбранные платформы уже опубликованы
      if (platformsToPublish.length === 0) {
        return res.status(409).json({
          error: 'Все выбранные платформы уже опубликованы',
          alreadyPublished: alreadyPublishedPlatforms,
          message: `Контент уже опубликован в: ${alreadyPublishedPlatforms.join(', ')}`
        });
      }

      // Информируем о частичной публикации
      if (alreadyPublishedPlatforms.length > 0) {
        log(`Частичная публикация: ${platformsToPublish.join(', ')} (уже опубликовано: ${alreadyPublishedPlatforms.join(', ')})`, 'api');
      }
      
      // Получаем настройки кампании
      const campaign = await storage.getCampaignById(content.campaignId, req.user?.token);
      if (!campaign) {
        log(`Кампания ${content.campaignId} не найдена при попытке публикации контента`, 'api');
        return res.status(404).json({ error: `Кампания ${content.campaignId} не найдена` });
      }
      
      // Получаем админский токен для обновления статуса публикации
      const systemToken = await socialPublishingService.getSystemToken();
      if (!systemToken) {
        log(`Не удалось получить системный токен для публикации контента`, 'api');
      } else {
        log(`Системный токен для публикации контента получен успешно`, 'api');
      }
      
      // STORIES: Generate image with text overlays BEFORE publishing to any platform
      let storyGeneratedImageUrl: string | null = null;
      if (content.content_type === 'story') {
        log(`[stories-publish] Detected story content, generating image with text overlays...`, 'api');
        storyGeneratedImageUrl = await generateStoryImageWithText(content);
        if (storyGeneratedImageUrl) {
          log(`[stories-publish] Generated story image: ${storyGeneratedImageUrl}`, 'api');
          // Update content object with generated image URL for all platforms
          content.image_url = storyGeneratedImageUrl;
          content.storyGeneratedImageUrl = storyGeneratedImageUrl;
        } else {
          log(`[stories-publish] Could not generate story image, using original`, 'api');
        }
      }
      
      // Публикуем контент во все указанные платформы
      const results: Record<string, any> = {}; 
      let hasSuccess = false;
      
      // Получаем гарантированный системный токен для обновлений
      let updateToken = systemToken;
      try {
        const { directusAuthManager } = await import('../services/directus-auth-manager');
        const guaranteedAdminToken = await directusAuthManager.getAdminAuthToken();
        if (guaranteedAdminToken) {
          updateToken = guaranteedAdminToken;
        }
      } catch (e) {
        log(`[handlePublishContent] Failed to get guaranteed admin token: ${e}`, 'api');
      }

      // Сбрасываем успешный результат для повторных попыток
      if (force) {
        log(`Принудительная повторная публикация контента ${content.id || 'без ID'}`, 'api');
      }

      try {
        // Устанавливаем статус в pending для всех платформ
        if (content.id) {
          // Создаем socialPlatforms объект, если его нет
          const socialPlatforms = content.socialPlatforms || {};
          
          const updatedPlatforms: Record<string, any> = {};
          
          // Обновляем статус только для платформ, которые нужно опубликовать
          for (const platform of platformsToPublish) {
            updatedPlatforms[platform] = {
              ...(socialPlatforms[platform] || {}),
              status: 'pending',
              error: null
            };
          }
          
          // Обновляем контент через хранилище
          console.log(`🔄 [PUBLISH] ПЕРЕД updateCampaignContent для ${content.id}`);
          await storage.updateCampaignContent(content.id, {
            socialPlatforms: {
              ...socialPlatforms,
              ...updatedPlatforms
            }
          }, updateToken || activeToken || undefined);
          
          console.log(`✅ [PUBLISH] ПОСЛЕ updateCampaignContent для ${content.id}`);
          log(`Статус публикации установлен в pending для контента ${content.id}`, 'api');
        }
        
        console.log(`🚀 [PUBLISH] НАЧИНАЕМ ПУБЛИКАЦИЮ в платформы: ${platformsToPublish.join(', ')}`);
        
        // Публикуем ТОЛЬКО на платформы, которые нужно опубликовать
        for (const platformName of platformsToPublish) {
          console.log(`📤 [PUBLISH] ВХОДИМ В ЦИКЛ для платформы: ${platformName}`);
          const platform = platformName as SocialPlatform;
          
          try {
            console.log(`📤 [PUBLISH] TRY блок для: ${platform}`);
            log(`Публикация контента в ${platform}`, 'api');
            
            let result;
            
            // Специальная обработка для YouTube - прямая публикация через API
            if (platform === 'youtube') {
              log(`YouTube: Прямая публикация контента ${content.id}`, 'api');
              
              const { YouTubeService } = await import('../services/social-platforms/youtube-service');
              const youtubeService = new YouTubeService();
              
              // Получаем настройки YouTube из кампании
              const youtubeSettings = campaign.social_media_settings?.youtube;
              if (!youtubeSettings) {
                throw new Error('YouTube настройки не найдены в кампании');
              }
              
              result = await youtubeService.publishContent(
                content,
                { youtube: youtubeSettings },
                userId || content.user_id
              );
              
              log(`YouTube: Результат публикации - ${JSON.stringify(result)}`, 'api');
              
              // Обновляем статус публикации YouTube в базе данных
              if (content.id && updateToken) {
                try {
                  const socialPlatforms = content.socialPlatforms || {};
                  const updateData = {
                    socialPlatforms: {
                      ...socialPlatforms,
                      youtube: {
                        ...(socialPlatforms.youtube || {}),
                        status: result.success ? 'published' : 'failed',
                        postUrl: result.postUrl || null,
                        error: result.success ? null : result.error,
                        publishedAt: result.success ? new Date().toISOString() : null
                      }
                    }
                  };
                  
                  await storage.updateCampaignContent(content.id, updateData, updateToken);
                  log(`YouTube: Статус обновлен в базе данных - ${result.success ? 'published' : 'failed'}`, 'api');
                } catch (updateError: any) {
                  log(`YouTube: Ошибка обновления статуса в базе: ${updateError.message}`, 'api');
                }
              }
            } else {
              // Обычная публикация через N8N для остальных платформ
              result = await socialPublishingService.publishToPlatform(content, platform, campaign, updateToken || activeToken || undefined);
            }
            
            const platformSuccess = result && result.status !== 'failed';
            results[platform] = {
              success: platformSuccess,
              result,
              contentId: content.id,
              error: result?.error || null
            };
            
            if (platformSuccess) {
              hasSuccess = true;
            }
            
            if (result && result.status === 'failed') {
              log(`Публикация в ${platform} не удалась: ${result.error || 'неизвестная ошибка'}`, 'api');
            } else if (result && result.messageId) {
              log(`Публикация в ${platform} успешна, messageId: ${result.messageId}`, 'api');
            } else if (result && result.postUrl) {
              log(`Публикация в ${platform} успешна, postUrl: ${result.postUrl}`, 'api');
            } else {
              log(`Запрос на публикацию в ${platform} отправлен (status: ${result?.status || 'unknown'})`, 'api');
            }
          } catch (platformError: any) {
            results[platform] = {
              success: false,
              error: platformError.message || 'Неизвестная ошибка',
              contentId: content.id
            };
            
            log(`Ошибка публикации в ${platform}: ${platformError.message}`, 'api');
            
            // Обновляем статус публикации в Directus
            if (content.id) {
              // Если есть системный токен, обновляем статус публикации
              if (updateToken || activeToken) {
                try {
                  const socialPlatforms = content.socialPlatforms || {};
                  
                  await storage.updateCampaignContent(content.id, {
                    socialPlatforms: {
                      ...socialPlatforms,
                      [platform]: {
                        ...(socialPlatforms[platform] || {}),
                        status: 'failed',
                        error: platformError.message || 'Неизвестная ошибка'
                      }
                    }
                  }, updateToken || activeToken || undefined);
                  
                  log(`Статус публикации обновлен на failed для ${platform}`, 'api');
                } catch (updateError: any) {
                  log(`Ошибка при обновлении статуса публикации: ${updateError.message}`, 'api');
                }
              } else {
                log(`Не удалось обновить статус публикации для ${platform} - нет токена`, 'api');
              }
            }
          }
        }
      } catch (error: any) {
        log(`Общая ошибка публикации: ${error.message}`, 'api');
        return res.status(500).json({
          error: 'Ошибка при публикации контента',
          message: error.message,
          details: results
        });
      }
      
      // Возвращаем результат
      if (hasSuccess) {
        return res.status(200).json({
          success: true,
          results
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Не удалось опубликовать контент ни на одной платформе',
          results
        });
      }
    } catch (error: any) {
      log(`Ошибка при публикации контента: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при публикации контента', 
        message: error.message 
      });
    }
  }

  // Публикация контента по ID, с указанием платформ
  // ВАЖНО: Пропускаем зарезервированные пути которые обрабатываются другими роутерами
  app.post('/api/publish/:contentId', authenticateUser, async (req: Request, res: Response, next) => {
    const { contentId } = req.params;
    
    // Список зарезервированных путей - пропускаем их для других обработчиков
    const reservedPaths = ['now', 'auto-update-status', 'update-status', 'content', 'direct-youtube', 'check-scheduled', 'toggle-publishing', 'reset-processed-cache', 'diagnose', 'test-webhook'];
    if (reservedPaths.includes(contentId)) {
      return next();
    }
    
    try {
      const { platforms } = req.body;

      log(`Запрос на ручную публикацию контента ${contentId} в платформы: ${JSON.stringify(platforms)}`, 'api');

      // Проверяем параметры
      if (!contentId) {
        return res.status(400).json({ error: 'Не указан ID контента' });
      }

      // Обработка двух возможных форматов платформ: массив или объект
      let selectedPlatforms: string[] = [];
      
      if (Array.isArray(platforms)) {
        // Формат массива: ["telegram", "vk"]
        selectedPlatforms = platforms;
      } else if (platforms && typeof platforms === 'object') {
        // Формат объекта: {telegram: true, vk: true, instagram: false}
        selectedPlatforms = Object.entries(platforms)
          .filter(([_, selected]) => selected === true)
          .map(([name]) => name);
      }
      
      // Проверка, что выбрана хотя бы одна платформа
      if (!selectedPlatforms.length) {
        log(`[publishing-routes] Ошибка: не указаны платформы для публикации контента ${contentId}. Переданные данные: ${JSON.stringify(platforms)}`, 'api');
        return res.status(400).json({ error: 'Не указаны платформы для публикации' });
      }
      
      // Заменяем оригинальные platforms на преобразованный массив, чтобы не менять остальной код
      const platformsArray = selectedPlatforms;

      // КРИТИЧЕСКАЯ ЗАЩИТА: Проверяем наличие уже опубликованного контента
      const existingContent = await storage.getCampaignContentById(contentId, req.user?.token);
      if (!existingContent) {
        log(`Контент ${contentId} не найден при попытке публикации`, 'api');
        return res.status(404).json({ error: 'Контент не найден' });
      }

      // Проверяем статусы выбранных платформ на предмет уже выполненной публикации
      const alreadyPublishedPlatforms: string[] = [];
      const platformsToPublish: string[] = [];
      
      if (existingContent.socialPlatforms && typeof existingContent.socialPlatforms === 'object') {
        for (const platform of platformsArray) {
          const platformData = existingContent.socialPlatforms[platform];
          
          // Платформа считается уже опубликованной, если есть статус 'published' И postUrl
          if (platformData && platformData.status === 'published' && platformData.postUrl && platformData.postUrl.trim() !== '') {
            alreadyPublishedPlatforms.push(platform);
            log(`БЛОКИРОВКА: Платформа ${platform} уже опубликована (postUrl: ${platformData.postUrl}), пропускаем`, 'api');
          } else {
            platformsToPublish.push(platform);
            
            // Сбрасываем некорректные published статусы без postUrl
            if (platformData && platformData.status === 'published' && (!platformData.postUrl || platformData.postUrl.trim() === '')) {
              log(`ИСПРАВЛЕНИЕ: Сброс некорректного статуса 'published' без postUrl для платформы ${platform}`, 'api');
              try {
                await storage.updateCampaignContent(contentId, {
                  socialPlatforms: {
                    ...existingContent.socialPlatforms,
                    [platform]: {
                      ...(existingContent.socialPlatforms[platform] || {}),
                      status: 'pending',
                      error: null
                    }
                  }
                }, req.user?.token);
              } catch (updateError: any) {
                log(`Ошибка при сбросе статуса платформы ${platform}: ${updateError.message}`, 'api');
              }
            }
          }
        }
      } else {
        // Если нет данных о платформах, публикуем во все выбранные
        platformsToPublish.push(...platformsArray);
      }

      // Если все выбранные платформы уже опубликованы
      if (platformsToPublish.length === 0) {
        return res.status(409).json({
          error: 'Все выбранные платформы уже опубликованы',
          alreadyPublished: alreadyPublishedPlatforms,
          message: `Контент уже опубликован в: ${alreadyPublishedPlatforms.join(', ')}`
        });
      }

      // Информируем о том, какие платформы будут опубликованы
      if (alreadyPublishedPlatforms.length > 0) {
        log(`Частичная публикация: ${platformsToPublish.join(', ')} (уже опубликовано: ${alreadyPublishedPlatforms.join(', ')})`, 'api');
      }

      // Получаем контент
      const content = await storage.getCampaignContentById(contentId, req.user?.token);
      if (!content) {
        log(`Контент ${contentId} не найден при попытке публикации`, 'api');
        return res.status(404).json({ error: 'Контент не найден' });
      }

      // Получаем кампанию
      const campaign = await storage.getCampaignById(content.campaignId, req.user?.token);
      if (!campaign) {
        log(`Кампания ${content.campaignId} не найдена при попытке публикации контента ${contentId}`, 'api');
        return res.status(404).json({ error: `Кампания ${content.campaignId} не найдена` });
      }

      // Получаем админский токен для обновления статуса публикации
      const systemToken = await socialPublishingService.getSystemToken();
      if (!systemToken) {
        log(`Не удалось получить системный токен для публикации контента ${contentId}`, 'api');
      } else {
        log(`Системный токен для публикации контента ${contentId} получен успешно`, 'api');
      }

      // Публикуем контент во все указанные платформы
      const results: Record<string, any> = {};
      let hasSuccess = false;

      try {
        // Устанавливаем статус в pending для всех платформ
        // Создаем socialPlatforms объект, если его нет
        const socialPlatforms = content.socialPlatforms || {};
        
        const updatedPlatforms: Record<string, any> = {};
        
        // Обновляем статус только для платформ, которые нужно опубликовать
        for (const platform of platformsToPublish) {
          updatedPlatforms[platform] = {
            ...(socialPlatforms[platform] || {}),
            status: 'pending',
            error: null
          };
        }
        
        // Обновляем контент через хранилище
        await storage.updateCampaignContent(content.id, {
          socialPlatforms: {
            ...socialPlatforms,
            ...updatedPlatforms
          }
        }, systemToken || undefined);
        
        log(`Статус публикации установлен в pending для контента ${content.id}`, 'api');
        
        // Публикуем ТОЛЬКО на платформы, которые нужно опубликовать
        for (const platformName of platformsToPublish) {
          const platform = platformName as SocialPlatform;
          
          try {
            log(`Публикация контента ${content.id} в ${platform}`, 'api');
            
            // Публикуем контент в выбранную платформу
            const result = await socialPublishingService.publishToPlatform(content, platform, campaign, systemToken || undefined);
            
            results[platform] = {
              success: true,
              result,
              contentId: content.id
            };
            
            hasSuccess = true;
            
            if (result && result.messageId) {
              log(`Публикация ${content.id} в ${platform} успешна, messageId: ${result.messageId}`, 'api');
            } else if (result && result.url) {
              log(`Публикация ${content.id} в ${platform} успешна, url: ${result.url}`, 'api');
            } else {
              log(`Публикация ${content.id} в ${platform} успешна, результат без messageId`, 'api');
            }
          } catch (platformError: any) {
            results[platform] = {
              success: false,
              error: platformError.message || 'Неизвестная ошибка',
              contentId: content.id
            };
            
            log(`Ошибка публикации ${content.id} в ${platform}: ${platformError.message}`, 'api');
            
            // Если есть системный токен, обновляем статус публикации
            if (systemToken) {
              try {
                const socialPlatforms = content.socialPlatforms || {};
                
                await storage.updateCampaignContent(content.id, {
                  socialPlatforms: {
                    ...socialPlatforms,
                    [platform]: {
                      ...(socialPlatforms[platform] || {}),
                      status: 'failed',
                      error: platformError.message || 'Неизвестная ошибка'
                    }
                  }
                }, systemToken);
                
                log(`Статус публикации ${content.id} обновлен на failed для ${platform}`, 'api');
              } catch (updateError: any) {
                log(`Ошибка при обновлении статуса публикации ${content.id}: ${updateError.message}`, 'api');
              }
            } else {
              log(`Не удалось обновить статус публикации ${content.id} для ${platform} - нет системного токена`, 'api');
            }
          }
        }
      } catch (error: any) {
        log(`Общая ошибка публикации ${contentId}: ${error.message}`, 'api');
        return res.status(500).json({
          error: 'Ошибка при публикации контента',
          message: error.message,
          details: results
        });
      }
      
      // Возвращаем результат
      if (hasSuccess) {
        return res.status(200).json({
          success: true,
          results
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Не удалось опубликовать контент ни на одной платформе',
          results
        });
      }
    } catch (error: any) {
      log(`Ошибка при публикации контента с ID ${req.params.contentId}: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при публикации контента', 
        message: error.message 
      });
    }
  });

  // Получение статуса публикации
  app.get('/api/publish/status/:contentId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      
      // Проверяем параметры
      if (!contentId) {
        return res.status(400).json({ error: 'Не указан ID контента' });
      }
      
      // Получаем контент
      const content = await storage.getCampaignContentById(contentId, req.user?.token);
      if (!content) {
        return res.status(404).json({ error: 'Контент не найден' });
      }
      
      // Возвращаем статус публикации по платформам
      return res.status(200).json({ 
        success: true, 
        data: {
          contentId: content.id,
          status: content.status,
          scheduledAt: content.scheduledAt,
          socialPlatforms: content.socialPlatforms || {}
        }
      });
    } catch (error: any) {
      log(`Ошибка при получении статуса публикации: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при получении статуса публикации',
        message: error.message
      });
    }
  });

  // Отмена запланированной публикации
  app.post('/api/publish/cancel/:contentId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const authToken = req.user?.token;
      
      // Проверяем параметры
      if (!contentId) {
        return res.status(400).json({ error: 'Не указан ID контента' });
      }
      
      // Получаем контент С ТОКЕНОМ АВТОРИЗАЦИИ
      const content = await storage.getCampaignContentById(contentId, authToken);
      if (!content) {
        return res.status(404).json({ error: 'Контент не найден' });
      }
      
      // Используем токен для последующих операций
      if (authToken) {
        
        // Настраиваем временно токен для пользователя, если есть userId в контенте
        if (content.userId) {
          directusApiManager.cacheAuthToken(content.userId, authToken);
        }
      }
      
      // Разрешаем отмену для любого контента с scheduledAt или статусом scheduled/pending
      // (пост мог сменить статус пока висел в списке — не блокируем отмену)
      
      // Создаем типизированную копию объекта socialPlatforms
      const typedPlatforms: Record<string, any> = content.socialPlatforms 
        ? JSON.parse(JSON.stringify(content.socialPlatforms)) 
        : {};
      
      // Создаем новый объект для обновленных платформ
      const updatedPlatforms: Record<string, any> = {};
      
      // Обрабатываем каждую платформу
      for (const platform of Object.keys(typedPlatforms)) {
        const platformData = typedPlatforms[platform];
        
        // Проверяем наличие данных и статуса
        if (platformData && typeof platformData === 'object') {
          if (platformData.status === 'scheduled' || platformData.status === 'pending') {
            // Копируем все свойства и изменяем статус
            updatedPlatforms[platform] = {
              ...platformData,
              status: 'cancelled'
            };
          } else {
            // Сохраняем без изменений
            updatedPlatforms[platform] = { ...platformData };
          }
        }
      }
      
      // Обновляем контент через интерфейс хранилища и напрямую через API
      let directUpdateSuccessful = false;
      
      try {
        // Сначала попробуем прямое обновление через API
        if (authToken) {
          log(`Отмена публикации ${contentId} через API напрямую`, 'api');
          
          const directUpdateResponse = await directusApiManager.request({
            url: `/items/campaign_content/${contentId}`,
            method: 'patch',
            data: {
              status: 'draft',
              scheduled_at: null,
              social_platforms: {} // Полностью очищаем платформы при отмене
            },
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          
          log(`Публикация ${contentId} успешно отменена через API напрямую`, 'api');
          directUpdateSuccessful = true;
        }
      } catch (directUpdateError: any) {
        log(`Ошибка при прямом обновлении через API: ${directUpdateError.message}`, 'api');
      }
      
      // Обновляем также через интерфейс хранилища
      try {
        await storage.updateCampaignContent(contentId, {
          status: 'draft', // Возвращаем в статус черновика
          scheduledAt: null, // Убираем планирование
          socialPlatforms: {} // Полностью очищаем платформы при отмене
        });
        log(`Публикация ${contentId} отменена через storage`, 'api');
      } catch (storageError: any) {
        // Если прямое обновление не было успешным и произошла ошибка в хранилище,
        // то выбрасываем исключение
        if (!directUpdateSuccessful) {
          throw new Error(`Failed to cancel publication: ${storageError.message}`);
        } else {
          log(`Предупреждение: Ошибка при отмене через storage, но прямое обновление прошло успешно: ${storageError.message}`, 'api');
        }
      }
      
      log(`Публикация ${contentId} полностью отменена`, 'api');

      // GET /api/campaign-content is cached for 60 seconds. Without invalidation,
      // the scheduled publications page receives the pre-cancel version even
      // after a successful refetch.
      const userId = req.user?.id;
      const campaignId = (content as any).campaignId || (content as any).campaign_id;
      const normalizedCampaignId = typeof campaignId === 'object' ? campaignId?.id : campaignId;
      if (userId) {
        invalidateContentCache(userId, normalizedCampaignId);
      }
      
      return res.status(200).json({ 
        success: true, 
        message: 'Публикация успешно отменена'
      });
    } catch (error: any) {
      log(`Ошибка при отмене публикации: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при отмене публикации',
        message: error.message
      });
    }
  });
  
  // УДАЛЕН: Дублирующий endpoint /api/publish/scheduled
  // Теперь используется единый endpoint из server/routes.ts:11916
  
  // Маршрут для обновления контента кампании через публикационный интерфейс
  app.patch('/api/publish/update-content/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const requestUpdates = req.body || {};
      const updates: Record<string, any> = {
        ...requestUpdates,
        ...(Object.prototype.hasOwnProperty.call(requestUpdates, 'scheduled_at')
          ? { scheduledAt: requestUpdates.scheduled_at }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(requestUpdates, 'social_platforms')
          ? { socialPlatforms: requestUpdates.social_platforms }
          : {}),
      };
      const token = req.user?.token;
      
      let userId = req.user?.id || '';
      
      if (token && userId) {
        directusApiManager.cacheAuthToken(userId, token);
      }
      
      // Получаем контент с помощью токена
      let content = await storage.getCampaignContentById(id, token);
      
      // Если контент не найден, возвращаем 404
      if (!content) {
        return res.status(404).json({ error: 'Контент не найден' });
      }
      
      // Используем идентификатор пользователя из контента, если он не указан в обновлениях
      if (!updates.userId && content.userId) {
        updates.userId = content.userId;
      }
      
      // Обновляем контент с передачей токена авторизации
      const updatedContent = await storage.updateCampaignContent(id, updates, token);

      const rawCampaignId = content.campaignId || (content as any).campaign_id;
      const campaignId = typeof rawCampaignId === 'object' ? rawCampaignId?.id : rawCampaignId;
      if (userId && campaignId) {
        invalidateContentCache(userId, campaignId);
      }
      
      return res.status(200).json({
        success: true,
        data: updatedContent
      });
    } catch (error: any) {
      log(`Ошибка при обновлении контента: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при обновлении контента', 
        message: error.message 
      });
    }
  });
  
  // Повтор публикации для платформ с ошибкой
  app.post('/api/retry-failed/:contentId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      if (!token || !userId) return res.status(401).json({ error: 'Не авторизован' });

      // Получаем контент
      const contentResp = await directusApiManager.request({
        url: `/items/campaign_content/${contentId}`,
        method: 'get',
        headers: { Authorization: `Bearer ${token}` }
      });
      const item = contentResp?.data?.data;
      if (!item) return res.status(404).json({ error: 'Контент не найден' });

      const platforms: Record<string, any> = item.social_platforms || {};
      const failedPlatforms = Object.entries(platforms).filter(([, p]: any) => p?.status === 'failed');
      if (failedPlatforms.length === 0) {
        return res.status(400).json({ error: 'Нет платформ с ошибкой' });
      }

      // Сбрасываем failed → pending для каждой упавшей платформы
      const updatedPlatforms = { ...platforms };
      for (const [name] of failedPlatforms) {
        updatedPlatforms[name] = {
          ...updatedPlatforms[name],
          status: 'pending',
          error: null,
          lastError: null,
          errorCode: null,
          failedAt: null
        };
      }

      await directusApiManager.request({
        url: `/items/campaign_content/${contentId}`,
        method: 'patch',
        data: { status: 'scheduled', social_platforms: updatedPlatforms },
        headers: { Authorization: `Bearer ${token}` }
      });

      // Сбрасываем кеш и запускаем планировщик
      invalidateContentCache(userId, item.campaign_id);
      try {
        const scheduler = getPublishScheduler();
        if (scheduler && typeof (scheduler as any).runNow === 'function') {
          (scheduler as any).runNow();
        }
      } catch {}

      log(`[retry-failed] Сброшено ${failedPlatforms.length} платформ для ${contentId}`, 'api');
      res.json({ success: true, retried: failedPlatforms.map(([n]) => n) });
    } catch (err: any) {
      log(`[retry-failed] Ошибка: ${err.message}`, 'api', 'error');
      res.status(500).json({ error: err.message });
    }
  });

  // Прямое API для планирования публикаций без использования storage
  app.post('/api/direct-schedule/:contentId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const { scheduledAt, socialPlatforms } = req.body;
      
      log(`Получен запрос на планирование публикации ${contentId}`, 'api');
      const token = req.user?.token;
      const userId = req.user?.id;
      
      if (!contentId) {
        return res.status(400).json({ error: 'Не указан ID контента' });
      }
      
      if (!scheduledAt) {
        return res.status(400).json({ error: 'Не указана дата публикации' });
      }
      
      if (!socialPlatforms || typeof socialPlatforms !== 'object') {
        return res.status(400).json({ error: 'Не указаны платформы для публикации' });
      }
      
      if (token && userId) {
        directusApiManager.cacheAuthToken(userId, token);
      }
      
      // Проверяем существование контента и обновляем его через storage
      try {
        // Получаем контент через storage, передаем токен авторизации
        log(`Получаем контент с ID ${contentId} через хранилище, с токеном авторизации`, 'api');
        
        if (!token) {
          log(`Ошибка авторизации: токен не определен при получении контента ${contentId}`, 'api');
          return res.status(401).json({ 
            error: 'Ошибка авторизации', 
            message: 'Для планирования публикации необходимо авторизоваться'
          });
        }
        
        let content = await storage.getCampaignContentById(contentId, token);
        
        if (!content) {
          log(`Контент с ID ${contentId} не найден в базе данных`, 'api');
          
          // Пробуем через прямой API запрос без storage
          try {
            log(`Пробуем получить контент напрямую через API с токеном`, 'api');
            
            const directResponse = await directusApiManager.request({
              url: `/items/campaign_content/${contentId}`,
              method: 'get',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            if (!directResponse || !directResponse.data || !directResponse.data.data) {
              return res.status(404).json({ 
                error: 'Контент не найден', 
                message: `Контент с ID ${contentId} не найден ни одним из способов`
              });
            }
            
            // Создаем объект контента из прямого ответа API для дальнейшей обработки
            const contentData = directResponse.data.data;
            // Преобразуем имена полей из snake_case в camelCase для совместимости с нашей моделью
            content = {
              id: contentData.id,
              userId: contentData.user_id,
              createdAt: contentData.date_created ? new Date(contentData.date_created) : null,
              campaign_id: contentData.campaign_id,
              campaignId: contentData.campaign_id,
              title: contentData.title,
              content: contentData.content || '',
              contentType: contentData.content_type || 'text',
              imageUrl: contentData.image_url,
              additionalImages: contentData.additional_images,
              status: contentData.status || 'draft',
              scheduledAt: contentData.scheduled_at ? new Date(contentData.scheduled_at) : null,
              socialPlatforms: contentData.social_platforms || {},
              tags: contentData.tags || [],
              sourceId: contentData.source_id,
              sourceType: contentData.source_type,
              metadata: contentData.metadata || {},
              // Дополнительные поля, которые могут быть в Directus (опциональные)
              imagePrompt: contentData.image_prompt
            };
            
            log(`Контент получен через прямой API запрос`, 'api');
          } catch (apiError: any) {
            log(`Ошибка при попытке получить контент через API: ${apiError.message}`, 'api');
            return res.status(404).json({ 
              error: 'Контент не найден', 
              message: `Контент с ID ${contentId} не найден: ${apiError.message}`
            });
          }
        }
        
        // Обновляем контент через прямой API запрос
        try {
          log(`Прямое обновление контента ${contentId} через API для планирования`, 'api');
          
          // ИСПРАВЛЕНИЕ: ПОЛНАЯ ЗАМЕНА ПЛАТФОРМ, А НЕ ОБЪЕДИНЕНИЕ
          // Используем только те платформы, которые пришли в запросе
          // Это позволит корректно удалять неотмеченные платформы
          const mergedSocialPlatforms = { ...socialPlatforms };

          log(`КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Используем только выбранные платформы`, 'api');
          log(`Платформы из запроса: ${Object.keys(socialPlatforms).join(', ')}`, 'api');

          // Отсеиваем платформы, которые не настроены в кампании
          // (например, VK включён галкой, но OAuth-токена нет).
          // Не удаляем тихо — помечаем status='failed' + errorCode,
          // чтобы юзер видел в "Опубликованных" причину и машинный код.
          const skippedPlatforms: Array<{ platform: string; code: string; reason: string }> = [];
          try {
            const { filterConfiguredPlatforms } = await import('../services/platform-config-validator');
            const campaignId = (content as any)?.campaignId
              || (content as any)?.campaign_id
              || (typeof (content as any)?.campaign_id === 'object' ? (content as any).campaign_id?.id : undefined);

            if (campaignId) {
              const campaignResp = await directusApiManager.request({
                url: `/items/user_campaigns/${typeof campaignId === 'object' ? campaignId.id : campaignId}`,
                method: 'get',
                headers: { Authorization: `Bearer ${token}` }
              });
              const socialMediaSettings = campaignResp?.data?.data?.social_media_settings || {};
              const requested = Object.keys(mergedSocialPlatforms);
              const { configured, skipped } = filterConfiguredPlatforms(socialMediaSettings, requested);
              for (const s of skipped) {
                log(`Платформа ${s.platform} исключена из планирования: ${s.reason}`, 'api');
                mergedSocialPlatforms[s.platform] = {
                  ...(mergedSocialPlatforms[s.platform] || {}),
                  enabled: false,
                  status: 'failed',
                  errorCode: s.code,
                  lastError: s.reason,
                  failedAt: new Date().toISOString(),
                };
                skippedPlatforms.push(s);
              }
              if (configured.length === 0) {
                log(`Все платформы не настроены, но сохраняем со статусом failed`, 'api');
                // Не блокируем сохранение — пользователь может редактировать время,
                // платформы уже помечены как failed выше. Просто продолжаем.
              }
            }
          } catch (validationError: any) {
            log(`Предупреждение: не удалось проверить настройки платформ: ${validationError.message}`, 'api');
          }
          
          // Если поля socialPlatforms пустое или не содержит данных о времени публикации,
          // но указано общее время scheduledAt, применяем это время ко всем платформам
          const scheduledAtDate = new Date(scheduledAt);
          log(`Установлено общее время публикации: ${scheduledAtDate.toISOString()}`, 'api');
          
          // Получаем список всех платформ для публикации
          const allPlatforms = Object.keys(mergedSocialPlatforms);
          
          // Для каждой платформы проверяем наличие своего scheduledAt или scheduled_at
          allPlatforms.forEach(platform => {
            // Проверяем все возможные ключи для времени публикации
            const hasTime = mergedSocialPlatforms[platform] && 
                           (mergedSocialPlatforms[platform].scheduledAt || 
                            mergedSocialPlatforms[platform].scheduled_at);
            
            if (!mergedSocialPlatforms[platform]) {
              // Если платформа указана, но нет данных, создаем объект
              mergedSocialPlatforms[platform] = {
                platform: platform,
                status: 'pending',
                scheduledAt: scheduledAtDate.toISOString(),
                scheduled_at: scheduledAtDate.toISOString() // Добавляем оба формата для совместимости
              };
              log(`Создана новая запись для платформы ${platform} со временем ${scheduledAtDate.toISOString()}`, 'api');
            } 
            else if (!hasTime) {
              // Если у платформы отсутствует время публикации, устанавливаем общее
              mergedSocialPlatforms[platform].scheduledAt = scheduledAtDate.toISOString();
              mergedSocialPlatforms[platform].scheduled_at = scheduledAtDate.toISOString();
              log(`Установлено время для платформы ${platform}: ${scheduledAtDate.toISOString()}`, 'api');
            }
          });

          // Never persist the calendar widget's incidental time as the content
          // schedule. The content-level value follows the earliest platform.
          const canonicalScheduledAt = getCanonicalScheduledAt(
            mergedSocialPlatforms,
            scheduledAtDate,
          ) || scheduledAtDate.toISOString();
          
          // Добавляем подробное логирование для отладки
          log(`Платформы из запроса: ${JSON.stringify(socialPlatforms)}`, 'api');
          log(`Итоговые платформы с временем публикации: ${JSON.stringify(mergedSocialPlatforms)}`, 'api');
          
          const updateData = {
            status: 'scheduled',
            scheduled_at: canonicalScheduledAt,
            social_platforms: mergedSocialPlatforms // Обновленные данные о платформах
          };
          
          // Выполняем запрос к API Directus
          const updateResponse = await directusApiManager.request({
            url: `/items/campaign_content/${contentId}`,
            method: 'patch',
            data: updateData,
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          log(`Планирование контента ${contentId} через API успешно`, 'api');
          
          // Также обновляем через storage для синхронизации кэша
          try {
            await storage.updateCampaignContent(contentId, {
              status: 'scheduled',
              scheduledAt: new Date(canonicalScheduledAt),
              socialPlatforms: mergedSocialPlatforms // Используем объединенные платформы для согласованности с API
            }, token);
            
            log(`Контент ${contentId} также обновлен через storage`, 'api');
          } catch (storageError: any) {
            log(`Предупреждение: Не удалось обновить кэш storage для ${contentId}: ${storageError.message}`, 'api');
          }
          
          // Сбрасываем серверный кеш, чтобы следующий GET /api/campaign-content
          // вернул свежие данные с заполненным socialPlatforms
          if (userId) {
            const campaignId = (content as any)?.campaignId || (content as any)?.campaign_id;
            invalidateContentCache(userId, typeof campaignId === 'object' ? campaignId?.id : campaignId);
          }

          return res.status(200).json({
            success: true,
            message: 'Публикация успешно запланирована',
            contentId,
            scheduledAt,
            platforms: Object.keys(socialPlatforms)
          });
        } catch (updateError: any) {
          log(`Ошибка при обновлении контента через API: ${updateError.message}`, 'api');
          return res.status(500).json({
            error: 'Ошибка при планировании публикации',
            message: updateError.message
          });
        }
      } catch (error: any) {
        log(`Общая ошибка при планировании публикации: ${error.message}`, 'api');
        return res.status(500).json({
          error: 'Ошибка при планировании публикации',
          message: error.message
        });
      }
    } catch (error: any) {
      log(`Ошибка при планировании публикации: ${error.message}`, 'api');
      return res.status(500).json({ 
        error: 'Ошибка при планировании публикации', 
        message: error.message 
      });
    }
  });
}
