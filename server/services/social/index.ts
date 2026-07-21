import { telegramService } from './telegram-service';
import { vkService } from './vk-service';
import { instagramService } from './instagram-service';
import { facebookSocialService } from './facebook';
import { threadsService } from '../social-platforms/threads-service';
import { YouTubeService } from '../social-platforms/youtube-service';
import { youtubeVideoService } from '../social-platforms/youtube-video-service';
import { log } from '../../utils/logger';
import { getPublishScheduler } from '../publish-scheduler';
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
      log(`Настройки для ${platform}: ${settings[platform] ? 'есть (ключи: ' + Object.keys(settings[platform]).join(', ') + ')' : 'отсутствуют'}`, 'social-publishing');
      
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
          const { youtubeShortsService } = await import('../social-platforms/youtube-shorts-service');
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

      // Прямая публикация для остальных платформ
      if (platform === 'telegram') {
        return await telegramService.publishToPlatform(content, campaign, authToken);
      }
      if (platform === 'vk') {
        return await vkService.publishToPlatform(content, campaign);
      }
      if (platform === 'instagram') {
        const isStory = content.content_type === 'story' ||
          (content.metadata && (
            (typeof content.metadata === 'string' && content.metadata.includes('storyType')) ||
            (typeof content.metadata === 'object' && content.metadata?.storyType)
          ));
        if (isStory) {
          const { publishInstagramStory } = await import('../social-platforms/instagram-stories-service');
          const adminToken = await this.getSystemToken();
          const result = await publishInstagramStory(content.id, adminToken || '');
          return {
            platform: 'instagram',
            status: result.success ? 'published' : 'failed',
            publishedAt: result.success ? new Date().toISOString() : null,
            postUrl: result.postUrl,
            postId: result.postId,
            error: result.error || null
          };
        }
        return await instagramService.publishToPlatform(content, campaign, authToken);
      }
      if (platform === 'facebook') {
        return await facebookSocialService.publish(content, settings.facebook || settings);
      }
      return {
        platform,
        status: 'failed',
        publishedAt: null,
        error: `Платформа ${platform} не поддерживается для прямой публикации`
      };
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
   * @deprecated Устарело — n8n удалён. Метод оставлен для совместимости, но не вызывается.
   * Прямая публикация теперь происходит в publishToPlatform.
   */
  private async publishThroughN8nWebhook(content: any, platform: string, settings: any): Promise<any> {
    log(`[SocialPublishing] publishThroughN8nWebhook вызван для ${platform} — должен быть недостижим`, 'social-publishing', 'warn');
    throw new Error(`Платформа ${platform} не поддерживается для прямой публикации (n8n удалён)`);
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