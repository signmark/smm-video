import { telegramService } from './telegram-service';
import { vkService } from './vk-service';
import { instagramService } from './instagram-service';
import { facebookSocialService } from './facebook';
import { threadsService } from '../social-platforms/threads-service';
import { YouTubeService } from '../social-platforms/youtube-service';
import { youtubeVideoService } from '../social-platforms/youtube-video-service';
import { log } from '../../utils/logger';
import { getPublishScheduler } from '../publish-scheduler';
import { getN8nUrl } from '../../utils/n8n-utils';
import fetch from 'node-fetch';
import { stripMarkdown } from '../../utils/strip-markdown';

/**
 * Единый сервис для публикации контента в различные социальные сети
 */
export class SocialPublishingService {
  /**
   * Получает токен для доступа к API
   * Использует статический токен из переменных окружения
   * 
   * @returns {Promise<string|null>} Токен для авторизации запросов к API
   */
  public async getSystemToken(): Promise<string | null> {
    return process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || null;
  }
  /**
   * Публикует контент в выбранную социальную платформу
   * @param content Контент для публикации
   * @param platform Социальная платформа
   * @param settings Настройки социальных сетей
   * @returns Результат публикации
   */
  public async publishToPlatform(
    content: any,
    platform: string,
    campaign: any,
    authToken?: string
  ): Promise<any> {
    // КРИТИЧЕСКАЯ ПРОВЕРКА АРГУМЕНТОВ
    if (typeof platform !== 'string' && typeof content === 'string') {
      log(`⚠️ ПРЕДУПРЕЖДЕНИЕ: Аргументы publishToPlatform перепутаны. Исправляю...`, 'social-publishing');
      const temp = content;
      content = platform;
      platform = temp;
    }

    log(`Публикация контента ${content.id || 'без ID'} в ${platform}`, 'social-publishing');
    
    try {
      // КРИТИЧЕСКАЯ ЗАЩИТА: Проверяем, не опубликована ли уже платформа
      if (content.socialPlatforms && content.socialPlatforms[platform]) {
        const platformData = content.socialPlatforms[platform];
        
        // Если статус published И есть postUrl - блокируем повторную публикацию
        if (platformData.status === 'published' && platformData.postUrl && platformData.postUrl.trim() !== '') {
          log(`БЛОКИРОВКА ДУБЛИРОВАНИЯ: Платформа ${platform} уже опубликована (postUrl: ${platformData.postUrl})`, 'social-publishing');
          return {
            platform,
            status: 'published',
            publishedAt: platformData.publishedAt || new Date().toISOString(),
            messageId: platformData.messageId || null,
            url: platformData.postUrl,
            error: null
          };
        }
        
        // Умная обработка quota_exceeded для YouTube - проверяем, не обновились ли квоты
        if (platform === 'youtube' && platformData.status === 'quota_exceeded') {
          const quotaExceededTime = platformData.updatedAt ? new Date(platformData.updatedAt) : null;
          let shouldResetQuota = false;
          
          if (quotaExceededTime) {
            // YouTube квоты обновляются в полночь PT
            const nowPT = new Date();
            const ptOffset = -8 * 60; // Pacific Time offset in minutes
            const ptTime = new Date(nowPT.getTime() + ptOffset * 60000);
            
            const quotaPTTime = new Date(quotaExceededTime.getTime() + ptOffset * 60000);
            const daysDiff = Math.floor((ptTime.getTime() - quotaPTTime.getTime()) / (24 * 60 * 60 * 1000));
            
            if (daysDiff >= 1) {
              shouldResetQuota = true;
              log(`YouTube квоты обновились, сбрасываем quota_exceeded для ${content.id}`, 'social-publishing');
            }
          } else {
            shouldResetQuota = true;
            log(`Сбрасываем старый quota_exceeded статус без даты для ${content.id}`, 'social-publishing');
          }
          
          if (!shouldResetQuota) {
            log(`БЛОКИРОВКА ДУБЛИРОВАНИЯ: Платформа ${platform} квота превышена (квоты еще не обновились)`, 'social-publishing');
            return {
              platform,
              status: 'quota_exceeded',
              publishedAt: platformData.publishedAt || new Date().toISOString(),
              messageId: platformData.messageId || null,
              url: platformData.postUrl,
              error: 'YouTube API quota exceeded - waiting for daily reset'
            };
          }
          // Если квоты обновились, продолжаем публикацию
          log(`Квоты YouTube обновились, пробуем повторную публикацию для ${content.id}`, 'social-publishing');
        }
        
        // Сбрасываем некорректные published статусы без postUrl
        if (platformData.status === 'published' && (!platformData.postUrl || platformData.postUrl.trim() === '')) {
          log(`ИСПРАВЛЕНИЕ: Сброс некорректного статуса 'published' без postUrl для платформы ${platform}`, 'social-publishing');
        }
      }
      
      // Получаем настройки социальных сетей из объекта кампании
      const settings = campaign.social_media_settings || campaign.socialMediaSettings || campaign.settings || {};
      log(`Настройки для ${platform}: ${JSON.stringify(settings[platform])}`, 'social-publishing');
      
      // Threads публикуется напрямую (без n8n)
      if (platform === 'threads') {
        return await this.publishThroughThreads(content, settings.threads);
      }

      // YouTube публикуется напрямую (без n8n)
      if (platform === 'youtube') {
        const ct = (content.content_type || '').toLowerCase();
        const isShorts = ['clip', 'short', 'shorts', 'short_video', 'reel'].includes(ct);
        let result: { success: boolean; videoId?: string; videoUrl?: string; error?: string };
        if (isShorts) {
          const { youtubeShortsService } = await import('./social-platforms/youtube-shorts-service');
          result = await youtubeShortsService.publishShort(content.id, authToken);
        } else {
          result = await youtubeVideoService.publishVideo(content.id, authToken);
        }
        return {
          platform: 'youtube',
          status: result.success ? 'published' : 'failed',
          publishedAt: result.success ? new Date().toISOString() : null,
          postUrl: result.videoUrl,
          url: result.videoUrl,
          videoId: result.videoId,
          error: result.error || null,
        };
      }

      // Все остальные платформы идут через n8n webhook
      return await this.publishThroughN8nWebhook(content, platform, settings);
    } catch (error) {
      log(`Ошибка при публикации в ${platform}: ${error}`, 'social-publishing');
      return {
        platform,
        status: 'failed',
        publishedAt: null,
        error: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Публикует контент через n8n webhook (ЕДИНСТВЕННЫЙ способ публикации)
   */
  private async publishThroughN8nWebhook(content: any, platform: string, settings: any): Promise<any> {
    const baseN8nUrl = getN8nUrl();
    if (!baseN8nUrl) {
      throw new Error('N8N_URL не настроен');
    }
    
    // Проверяем тип контента для Instagram Stories
    const isStory = content.content_type === 'story' || 
                   (content.metadata && (
                     (typeof content.metadata === 'string' && content.metadata.includes('storyType')) ||
                     (typeof content.metadata === 'object' && content.metadata.storyType)
                   ));
    
    // Проверяем тип контента для VK Clips (Shorts)
    const isClip = content.content_type === 'clip' || 
                  content.content_type === 'short' ||
                  content.content_type === 'reel' ||
                  (content.metadata && (
                    (typeof content.metadata === 'string' && (content.metadata.includes('clipType') || content.metadata.includes('shortType'))) ||
                    (typeof content.metadata === 'object' && (content.metadata.clipType || content.metadata.shortType || content.metadata.isClip))
                  ));
    
    log(`🎬 ДЕТАЛЬНАЯ ПРОВЕРКА STORIES/CLIPS: Контент ${content.id}`, 'social-publishing');
    log(`  - content.content_type: ${content.content_type}`, 'social-publishing');
    log(`  - content.metadata: ${JSON.stringify(content.metadata)}`, 'social-publishing');
    log(`  - isStory результат: ${isStory}`, 'social-publishing');
    log(`  - isClip результат: ${isClip}`, 'social-publishing');
    
    // Определяем правильный webhook URL для VK
    let vkWebhookUrl = `${baseN8nUrl}/webhook/publish-vk`;
    if (isClip) {
      vkWebhookUrl = `${baseN8nUrl}/webhook/publish-vk-clips`;
    } else if (isStory) {
      vkWebhookUrl = `${baseN8nUrl}/webhook/publish-vk-stories`;
    }
    
    console.log(`🚀 [N8N-REQUEST] PLATFORM: ${platform}`);

    const webhookUrls = {
      'vk': vkWebhookUrl,
      'telegram': `${baseN8nUrl}/webhook/publish-telegram`, 
      'instagram': isStory ? `${baseN8nUrl}/webhook/publish-stories` : `${baseN8nUrl}/webhook/publish-instagram`,
      'facebook': `${baseN8nUrl}/webhook/publish-facebook`,
      'youtube': `${baseN8nUrl}/webhook/publish-youtube`
    };
    
    log(`🎬 WEBHOOK ВЫБОР: ${platform} -> ${webhookUrls[platform as keyof typeof webhookUrls]}`, 'social-publishing');

    const webhookUrl = webhookUrls[platform as keyof typeof webhookUrls];
    
    if (!webhookUrl) {
      log(`Платформа ${platform} не поддерживается через n8n webhook`, 'social-publishing');
      return {
        platform,
        status: 'failed',
        publishedAt: null,
        error: `Platform ${platform} webhook not configured`
      };
    }

    const requestBody = {
      contentId: content.id,
      title: content.title || '',
      content: content.content || '',
      image_url: content.imageUrl || content.image_url || '',
      video_url: content.videoUrl || content.video_url || '',
      platform: platform,
      contentType: content.content_type || content.contentType || '',
      isStory: isStory,
      isClip: isClip,
      settings: settings
    };

    console.log(`🚀 [N8N-REQUEST] PLATFORM: ${platform}`);
    console.log(`🚀 [N8N-REQUEST] URL: ${webhookUrl}`);
    console.log(`🚀 [N8N-REQUEST] BODY: ${JSON.stringify(requestBody, null, 2)}`);

    // Определяем нужен ли retry для платформы (VK error 10 — временный сбой серверов VK)
    const isTransientError = (errMsg: string) =>
      errMsg.includes('error 10') || errMsg.includes('error_code: 10') ||
      errMsg.includes('Internal server error') || errMsg.includes('check later');

    const MAX_RETRIES = platform === 'vk' ? 3 : 1;
    const RETRY_DELAY_MS = 3000;

    let lastError = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          log(`WEBHOOK RETRY: ${platform} попытка ${attempt}/${MAX_RETRIES} (предыдущая ошибка: ${lastError})`, 'social-publishing');
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt - 1)));
        }

        log(`WEBHOOK ПУБЛИКАЦИЯ: Отправка запроса в ${platform} через n8n: ${webhookUrl}`, 'social-publishing');

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          log(`WEBHOOK ОШИБКА: ${platform} webhook вернул ${response.status}: ${errorText}`, 'social-publishing');
          if (attempt < MAX_RETRIES && isTransientError(errorText)) continue;
          return { platform, status: 'failed', publishedAt: null, error: `Webhook error: ${lastError}` };
        }

        const responseText = await response.text();
        log(`WEBHOOK RAW RESPONSE: ${platform}: ${responseText.substring(0, 500)}`, 'social-publishing');

        if (!responseText || responseText.trim() === '') {
          log(`WEBHOOK: ${platform} вернул пустой ответ (fire-and-forget). Считаем отправленным.`, 'social-publishing');
          return { platform, status: 'sent', publishedAt: new Date(), postUrl: null, messageId: null, error: null };
        }

        let result: any;
        try {
          result = JSON.parse(responseText);
        } catch {
          log(`WEBHOOK: ${platform} вернул невалидный JSON: ${responseText.substring(0, 200)}`, 'social-publishing');
          return { platform, status: 'sent', publishedAt: new Date(), postUrl: null, messageId: null, error: null };
        }

        // Если VK вернул error 10 — retry
        if (result.success === false && attempt < MAX_RETRIES && isTransientError(result.error || '')) {
          lastError = result.error || '';
          log(`WEBHOOK VK ERROR 10: попытка ${attempt}, повторяем через ${RETRY_DELAY_MS}ms...`, 'social-publishing');
          continue;
        }

        log(`WEBHOOK УСПЕХ: ${platform} вернул результат: ${JSON.stringify(result)}`, 'social-publishing');
        return {
          platform,
          status: result.success ? 'published' : 'failed',
          publishedAt: new Date(),
          postUrl: result.postUrl || result.url || null,
          messageId: result.messageId || null,
          error: result.success === false ? (result.error || 'Unknown webhook error') : null
        };

      } catch (error: any) {
        lastError = error.message;
        log(`WEBHOOK ИСКЛЮЧЕНИЕ: ${platform} попытка ${attempt} - ${error.message}`, 'social-publishing');
        if (attempt >= MAX_RETRIES) {
          return { platform, status: 'failed', publishedAt: null, error: `Webhook exception: ${error.message}` };
        }
      }
    }

    return { platform, status: 'failed', publishedAt: null, error: lastError || 'Max retries exceeded' };
  }

  /**
   * КРИТИЧЕСКОЕ УПРОЩЕНИЕ: n8n сам обновляет статус и postUrl после публикации
   * Этот метод больше не нужен для ВК, Telegram, Instagram
   * @param contentId ID контента
   * @param platform Социальная платформа  
   * @param publicationResult Результат публикации
   * @returns Обновленный контент или null в случае ошибки
   */
  private async publishThroughThreads(content: any, settings: any): Promise<any> {
    const platform = 'threads';
    if (!settings?.accessToken || !settings?.threadsUserId) {
      log(`Threads не настроен для кампании`, 'social-publishing');
      return { platform, status: 'failed', publishedAt: null, error: 'Threads не настроен. Добавьте токен в настройках кампании.' };
    }

    const rawText = content.text_content || content.content || content.title || '';
    // Threads не поддерживает Markdown — убираем **жирный**, *курсив* и прочие маркеры
    const text = stripMarkdown(typeof rawText === 'string' ? rawText : String(rawText));
    const imageUrl = content.image_url || content.featured_image || undefined;
    const videoUrl = content.video_url || undefined;

    const result = await threadsService.publishPost(settings, { text, imageUrl, videoUrl });

    if (result.success) {
      return {
        platform,
        status: 'published',
        publishedAt: new Date().toISOString(),
        url: result.postUrl,
        postId: result.postId
      };
    } else {
      return { platform, status: 'failed', publishedAt: null, error: result.error };
    }
  }

  public async updatePublicationStatus(
    contentId: string, 
    platform: string, 
    publicationResult: any
  ) {
    // Facebook и Threads публикуются напрямую и требуют обновления статуса
    if (platform === 'facebook') {
      return await facebookSocialService.updatePublicationStatus(contentId, platform, publicationResult);
    }

    if (platform === 'threads') {
      log(`THREADS: Обновляем статус публикации для ${contentId}`, 'social-publishing');
      return publicationResult;
    }
    
    // Для остальных платформ возвращаем результат как есть - n8n все сделает сам
    log(`N8N АВТООБНОВЛЕНИЕ: Платформа ${platform} - статус и postUrl обновит n8n`, 'social-publishing');
    return publicationResult;
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const socialPublishingService = new SocialPublishingService();