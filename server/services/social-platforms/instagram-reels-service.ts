/**
 * Instagram Reels Publishing Service
 * 
 * Публикация коротких видео как Instagram Reels через Graph API
 */

import axios from 'axios';
import { log } from '../../utils/logger';
import { directusApi } from '../../directus';
import { TokenValidationResult } from './base-service';

const LOG_PREFIX = 'instagram-reels';

export interface InstagramReelsPublishResult {
  success: boolean;
  mediaId?: string;
  postUrl?: string;
  error?: string;
}

export interface InstagramReelsContent {
  id: string;
  campaign_id: string;
  video_url?: string;
  title?: string;
  content?: string;
  social_platforms?: Record<string, any>;
}

export interface InstagramSettings {
  accessToken: string;
  businessAccountId: string;
}

export class InstagramReelsService {
  
  /**
   * Проверяет валидность Instagram токена
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const token = settings.accessToken || settings.token;
    const businessId = settings.businessAccountId;
    
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // 1. Проверяем токен и права через /me
      const response = await axios.get(`https://graph.facebook.com/v17.0/me`, {
        params: { 
          fields: 'id,name',
          access_token: token 
        }
      });

      // 2. Если есть businessId, проверяем что он доступен
      if (businessId) {
        const igRes = await axios.get(`https://graph.facebook.com/v17.0/${businessId}`, {
          params: { 
            fields: 'id,username,name',
            access_token: token 
          }
        });
        if (!igRes.data.id) {
          return { isValid: false, error: `Аккаунт ${businessId} недоступен` };
        }
      }

      return { isValid: true };
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message;
      return { isValid: false, error: msg };
    }
  }

  /**
   * Публикует видео как Instagram Reels
   */
  async publishReels(
    contentId: string,
    authToken?: string
  ): Promise<InstagramReelsPublishResult> {
    try {
      log(`Начинаю публикацию Instagram Reels для контента ${contentId}`, LOG_PREFIX);
      
      // 1. Получить контент
      const content = await this.getContent(contentId, authToken);
      if (!content) {
        return { success: false, error: 'Контент не найден' };
      }
      
      // 2. Проверить наличие видео
      if (!content.video_url) {
        return { success: false, error: 'Видео URL не найден. Reels требует видео.' };
      }
      
      // 3. Получить Instagram настройки из кампании
      const igSettings = await this.getInstagramSettings(content.campaign_id, authToken);
      if (!igSettings) {
        return { success: false, error: 'Instagram настройки не найдены в кампании' };
      }
      
      log(`Оригинальный видео URL: ${content.video_url}`, LOG_PREFIX);
      log(`Business Account ID: ${igSettings.businessAccountId}`, LOG_PREFIX);
      
      // Проксируем видео через наш сервер для Instagram
      const proxyVideoUrl = this.getProxyVideoUrl(content.video_url);
      log(`Прокси видео URL: ${proxyVideoUrl}`, LOG_PREFIX);
      
      // 4. Создать контейнер для Reels
      // Очищаем HTML теги из текста (Tiptap сохраняет как HTML)
      const rawCaption = content.content || content.title || '';
      const cleanCaption = this.stripHtmlTags(rawCaption);
      
      const containerId = await this.createReelsContainer(
        igSettings,
        proxyVideoUrl,
        cleanCaption
      );
      
      if (!containerId) {
        return { success: false, error: 'Не удалось создать контейнер для Reels' };
      }
      
      // 5. Дождаться обработки видео
      const isReady = await this.waitForContainerReady(igSettings, containerId);
      if (!isReady) {
        const errorMsg = this.lastContainerError || 'Таймаут ожидания обработки видео Instagram';
        return { success: false, error: errorMsg };
      }
      
      // 6. Опубликовать контейнер
      const mediaId = await this.publishContainer(igSettings, containerId);
      
      if (!mediaId) {
        return { success: false, error: 'Не удалось опубликовать Reels' };
      }
      
      // 7. Получить permalink
      const postUrl = await this.getMediaPermalink(igSettings, mediaId);
      
      // 8. Обновить статус в Directus
      await this.updateContentStatus(contentId, mediaId, postUrl, authToken);
      
      log(`Instagram Reels опубликован успешно! ID: ${mediaId}, URL: ${postUrl}`, LOG_PREFIX);
      
      return {
        success: true,
        mediaId,
        postUrl
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      log(`Ошибка публикации Instagram Reels: ${errorMessage}`, LOG_PREFIX);
      console.error('[INSTAGRAM-REELS] Error:', error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * Получает контент из Directus
   */
  private async getContent(contentId: string, authToken?: string): Promise<InstagramReelsContent | null> {
    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return response.data.data;
    } catch (error) {
      log(`Ошибка получения контента: ${error}`, LOG_PREFIX);
      return null;
    }
  }
  
  /**
   * Получает Instagram настройки из кампании
   */
  private async getInstagramSettings(campaignId: string, authToken?: string): Promise<InstagramSettings | null> {
    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      const response = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const campaign = response.data.data;
      const igSettings = campaign.social_settings?.instagram || campaign.social_media_settings?.instagram;
      
      if (!igSettings?.businessAccountId || (!igSettings?.accessToken && !igSettings?.token)) {
        log('Instagram настройки неполные или отсутствуют', LOG_PREFIX);
        return null;
      }
      
      return {
        accessToken: igSettings.accessToken || igSettings.token,
        businessAccountId: igSettings.businessAccountId
      };
    } catch (error) {
      log(`Ошибка получения настроек кампании: ${error}`, LOG_PREFIX);
      return null;
    }
  }
  
  /**
   * Очищает HTML теги из текста
   * Tiptap сохраняет контент как HTML, нужно очистить для Instagram caption
   */
  private stripHtmlTags(html: string): string {
    if (!html) return '';
    
    // Заменяем <br> и </p> на переносы строк
    let text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n');
    
    // Удаляем все остальные HTML теги
    text = text.replace(/<[^>]*>/g, '');
    
    // Декодируем HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // Убираем множественные переносы строк
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text.trim();
  }
  
  /**
   * Преобразует URL видео в прокси URL нашего сервера
   * Instagram не может скачать видео с некоторых хостингов (например, российских S3)
   */
  private getProxyVideoUrl(originalUrl: string): string {
    try {
      // Извлекаем ID видео из S3 URL
      // Пример: https://xxx.s3.ru1.storage.beget.cloud/videos/abc123.mp4
      const urlParts = originalUrl.split('/');
      const videoFileName = urlParts[urlParts.length - 1]; // abc123.mp4
      
      // Получаем домен нашего сервера
      // Production: SMM_DOMAIN (smm.omemo.tech), Dev: REPLIT_DEV_DOMAIN
      const serverDomain = process.env.SMM_DOMAIN || process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
      
      if (!serverDomain) {
        log(`Домен сервера не найден, используем оригинальный URL`, LOG_PREFIX);
        return originalUrl;
      }
      
      // Формируем прокси URL
      const proxyUrl = `https://${serverDomain}/api/instagram-video-proxy/${videoFileName}`;
      log(`Сформирован прокси URL: ${proxyUrl}`, LOG_PREFIX);
      
      return proxyUrl;
    } catch (error) {
      log(`Ошибка формирования прокси URL: ${error}`, LOG_PREFIX);
      return originalUrl;
    }
  }
  
  /**
   * Создает контейнер для Reels (этап 1)
   */
  private async createReelsContainer(
    settings: InstagramSettings,
    videoUrl: string,
    caption: string
  ): Promise<string | null> {
    try {
      log(`Создаю контейнер для Reels: ${videoUrl.substring(0, 50)}...`, LOG_PREFIX);
      
      const url = `https://graph.facebook.com/v17.0/${settings.businessAccountId}/media`;
      
      const response = await axios.post(url, {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption.substring(0, 2200),
        share_to_feed: true,
        access_token: settings.accessToken
      }, {
        timeout: 120000
      });
      
      log(`Контейнер создан: ${JSON.stringify(response.data)}`, LOG_PREFIX);
      
      if (response.data.id) {
        return response.data.id;
      }
      
      if (response.data.error) {
        throw new Error(`Instagram API Error: ${response.data.error.message}`);
      }
      
      return null;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      log(`Ошибка создания контейнера Reels: ${errorMsg}`, LOG_PREFIX);
      throw new Error(`Ошибка создания контейнера: ${errorMsg}`);
    }
  }
  
  /**
   * Ожидает готовности контейнера (обработка видео)
   */
  private lastContainerError: string = '';
  
  private async waitForContainerReady(
    settings: InstagramSettings,
    containerId: string,
    maxAttempts: number = 30,
    delayMs: number = 5000
  ): Promise<boolean> {
    log(`Ожидаю обработку видео (container: ${containerId})...`, LOG_PREFIX);
    this.lastContainerError = '';
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const url = `https://graph.facebook.com/v17.0/${containerId}`;
        const response = await axios.get(url, {
          params: {
            fields: 'status_code,status',
            access_token: settings.accessToken
          }
        });
        
        const statusCode = response.data.status_code;
        const status = response.data.status;
        log(`Попытка ${attempt}/${maxAttempts}: статус = ${statusCode}`, LOG_PREFIX);
        
        if (statusCode === 'FINISHED') {
          log(`Видео обработано успешно!`, LOG_PREFIX);
          return true;
        }
        
        if (statusCode === 'ERROR') {
          this.lastContainerError = status || 'Неизвестная ошибка обработки видео';
          log(`Ошибка обработки видео: ${status}`, LOG_PREFIX);
          
          // Decode common Instagram error codes
          if (status?.includes('2207026')) {
            this.lastContainerError = 'Неподдерживаемый формат видео. Требуется MP4 с кодеком H.264/HEVC и AAC аудио.';
          } else if (status?.includes('2207052')) {
            this.lastContainerError = 'Проблема с форматом видео. Проверьте разрешение (макс. 1920px), кодек (H.264) и цветовое пространство (yuv420p).';
          } else if (status?.includes('2207076')) {
            this.lastContainerError = 'Instagram не смог загрузить видео (2207076). Видео недоступно с серверов Meta или неправильный формат. Требования Reels: MP4, H.264, AAC, 9:16, 3–90 сек, мин. 500px шириной.';
          } else if (status?.includes('2207077')) {
            this.lastContainerError = 'Instagram не смог загрузить видео. Возможные причины: видео недоступно для серверов Meta, HDR формат, или проблемы с хостингом.';
          } else if (status?.includes('2207001')) {
            this.lastContainerError = 'Временная ошибка сервера Instagram. Попробуйте позже.';
          } else if (status?.includes('2207027')) {
            this.lastContainerError = 'Медиа ещё не готово. Попробуйте позже.';
          }
          
          return false;
        }
        
        // IN_PROGRESS - продолжаем ожидание
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
      } catch (error: any) {
        log(`Ошибка проверки статуса: ${error.message}`, LOG_PREFIX);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    log(`Таймаут ожидания обработки видео`, LOG_PREFIX);
    this.lastContainerError = 'Таймаут ожидания обработки видео';
    return false;
  }
  
  /**
   * Публикует контейнер (этап 2)
   */
  private async publishContainer(
    settings: InstagramSettings,
    containerId: string
  ): Promise<string | null> {
    try {
      log(`Публикую контейнер ${containerId}...`, LOG_PREFIX);
      
      const url = `https://graph.facebook.com/v17.0/${settings.businessAccountId}/media_publish`;
      
      const response = await axios.post(url, {
        creation_id: containerId,
        access_token: settings.accessToken
      }, {
        timeout: 60000
      });
      
      log(`Ответ публикации: ${JSON.stringify(response.data)}`, LOG_PREFIX);
      
      if (response.data.id) {
        return response.data.id;
      }
      
      return null;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      log(`Ошибка публикации контейнера: ${errorMsg}`, LOG_PREFIX);
      throw new Error(`Ошибка публикации: ${errorMsg}`);
    }
  }
  
  /**
   * Получает permalink опубликованного медиа
   */
  private async getMediaPermalink(
    settings: InstagramSettings,
    mediaId: string
  ): Promise<string> {
    try {
      const url = `https://graph.facebook.com/v17.0/${mediaId}`;
      const response = await axios.get(url, {
        params: {
          fields: 'permalink',
          access_token: settings.accessToken
        }
      });
      
      return response.data.permalink || `https://www.instagram.com/reel/${mediaId}`;
    } catch (error) {
      log(`Не удалось получить permalink: ${error}`, LOG_PREFIX);
      return `https://www.instagram.com/reel/${mediaId}`;
    }
  }
  
  /**
   * Обновляет статус контента в Directus
   */
  private async updateContentStatus(
    contentId: string,
    mediaId: string,
    postUrl: string,
    authToken?: string
  ): Promise<void> {
    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      
      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const currentContent = contentResponse.data.data;
      const currentSocialPlatforms = currentContent.social_platforms || {};
      
      const publishedAt = new Date().toISOString();
      const igData = {
        postId: mediaId,
        status: 'published',
        postUrl: postUrl,
        platform: 'instagram',
        publishedAt: publishedAt,
        type: 'reels'
      };
      
      const updatedSocialPlatforms = {
        ...currentSocialPlatforms,
        instagram: igData
      };
      
      await directusApi.patch(`/items/campaign_content/${contentId}`, {
        social_platforms: updatedSocialPlatforms
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      log(`Статус контента обновлён, social_platforms.instagram сохранён`, LOG_PREFIX);
    } catch (error) {
      log(`Ошибка обновления статуса: ${error}`, LOG_PREFIX);
    }
  }
}

export const instagramReelsService = new InstagramReelsService();
