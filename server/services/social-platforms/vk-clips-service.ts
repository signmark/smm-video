/**
 * VK Clips Publishing Service
 * 
 * Сервис для публикации Клипов (коротких вертикальных видео) в ВКонтакте
 * Использует специальный clips.getUploadServer и clips.save API для публикации в раздел Клипы
 */

import axios from 'axios';
import FormData from 'form-data';
import { log } from '../../utils/logger';
import { directusApi } from '../../directus.js';
import { BaseSocialService, TokenValidationResult } from './base-service';
import { CampaignContent, SocialMediaSettings } from '@shared/schema';

const VK_API_VERSION = '5.199';
const LOG_PREFIX = 'vk-clips';

export interface VKClipsPublishResult {
  success: boolean;
  videoId?: string;
  ownerId?: string;
  videoUrl?: string;
  error?: string;
}

export interface VKClipsContent {
  id: string;
  campaign_id: string;
  video_url?: string;
  title?: string;
  description?: string;
  social_platforms?: Record<string, any>;
}

export interface VKSettings {
  groupId: string;
  token: string;
}

/**
 * VK Clips Publisher Service
 */
export class VKClipsService extends BaseSocialService {
  
  constructor() {
    super('vk-clips');
  }

  /**
   * Реализация метода публикации контента под единый интерфейс
   */
  async publishContent(
    content: CampaignContent,
    campaignSettings: SocialMediaSettings,
    userId: string
  ): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const result = await this.publishClip(content.id);
    return {
      success: result.success,
      postUrl: result.videoUrl,
      error: result.error
    };
  }

  /**
   * Проверяет валидность VK токена
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const token = settings.token;
    const groupId = settings.groupId;
    
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // Проверяем токен через users.get
      const response = await axios.post('https://api.vk.com/method/users.get', 
        new URLSearchParams({
          access_token: token,
          v: VK_API_VERSION
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (response.data.error) {
        return { isValid: false, error: response.data.error.error_msg };
      }

      // Если есть groupId, проверяем доступ к группе
      if (groupId) {
        const cleanId = groupId.replace('club', '').replace('-', '');
        const groupsRes = await axios.post('https://api.vk.com/method/groups.getById', 
          new URLSearchParams({
            group_id: cleanId,
            access_token: token,
            v: VK_API_VERSION
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        if (groupsRes.data.error) {
          return { isValid: false, error: `Нет доступа к группе ${groupId}: ${groupsRes.data.error.error_msg}` };
        }
      }

      return { isValid: true };
    } catch (error: any) {
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Публикует видео как Клип в VK
   */
  async publishClip(
    contentId: string,
    authToken?: string
  ): Promise<VKClipsPublishResult> {
    try {
      log(`Начинаю публикацию VK Clip для контента ${contentId}`, LOG_PREFIX);
      
      // 1. Получить контент
      const content = await this.getContent(contentId, authToken);
      if (!content) {
        return { success: false, error: 'Контент не найден' };
      }
      
      // 2. Проверить наличие видео
      if (!content.video_url) {
        return { success: false, error: 'Видео URL не найден. Клипы требуют видео.' };
      }
      
      // 3. Получить VK настройки из кампании
      const vkSettings = await this.getVKSettings(content.campaign_id, authToken);
      if (!vkSettings) {
        return { success: false, error: 'VK настройки не найдены в кампании' };
      }
      
      log(`Видео URL: ${content.video_url}`, LOG_PREFIX);
      
      // 4. Попытка использовать Clips API, с fallback на video.save
      let clipId: string;
      let ownerId: string;
      let videoUrl: string;
      
      try {
        // Сначала пробуем clips.getUploadServer (для Клипов VK)
        const { uploadUrl } = await this.getClipsUploadServer(
          vkSettings.token, 
          vkSettings.groupId
        );
        
        // 5. Скачать видео
        const videoBuffer = await this.downloadVideo(content.video_url);
        
        // 6. Загрузить видео на сервер клипов
        const uploadResult = await this.uploadVideoToClips(uploadUrl, videoBuffer);
        
        // 7. Сохранить клип через clips.save
        const result = await this.saveClip(
          vkSettings.token,
          vkSettings.groupId,
          uploadResult,
          content.description || content.title || ''
        );
        clipId = result.clipId;
        ownerId = result.ownerId;
        videoUrl = result.videoUrl;
        
      } catch (clipsError: any) {
        const isScopeError = clipsError.message?.includes('current scopes') ||
          clipsError.message?.includes('error_code 15') ||
          clipsError.message?.includes('[15]');
        const isUnknownMethod = clipsError.message?.includes('Unknown method') ||
          clipsError.message?.includes('error_code 3') ||
          clipsError.message?.includes('[3]');

        if (isScopeError) {
          // Токен не имеет нужных скоупов — video.save тоже не поможет
          throw new Error(
            'VK токен не имеет прав на публикацию видео/клипов. ' +
            'Переподключите VK аккаунт в настройках кампании и убедитесь, что выданы права: видео (video), стена (wall).'
          );
        }

        if (isUnknownMethod) {
          // Clips API недоступен для этого типа токена — пробуем video.save
          log(`Clips API недоступен (Unknown method), используем fallback video.save: ${clipsError.message}`, LOG_PREFIX);

          const fallbackResult = await this.publishAsVideo(
            content,
            vkSettings,
            content.description || content.title || ''
          );

          if (!fallbackResult.success) {
            throw new Error(fallbackResult.error || 'video.save тоже не удался');
          }

          clipId = fallbackResult.videoId!;
          ownerId = fallbackResult.ownerId!;
          videoUrl = fallbackResult.videoUrl!;
        } else {
          throw clipsError;
        }
      }
      
      // 8. Обновить статус в Directus
      await this.updateContentStatus(contentId, clipId, videoUrl, ownerId, authToken);
      
      log(`VK Clip опубликован успешно! ID: ${clipId}, URL: ${videoUrl}`, LOG_PREFIX);
      
      return {
        success: true,
        videoId: clipId,
        ownerId,
        videoUrl
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      log(`Ошибка публикации VK Clip: ${errorMessage}`, LOG_PREFIX);
      console.error('[VK-CLIPS] Error:', error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * Получает контент из Directus
   */
  private async getContent(contentId: string, authToken?: string): Promise<VKClipsContent | null> {
    try {
      const token = authToken || process.env.DIRECTUS_STATIC_TOKEN;
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
   * Получает VK настройки из кампании
   */
  private async getVKSettings(campaignId: string, authToken?: string): Promise<VKSettings | null> {
    try {
      const token = authToken || process.env.DIRECTUS_STATIC_TOKEN;
      const response = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const campaign = response.data.data;
      const vkSettings = campaign.social_settings?.vk || campaign.social_media_settings?.vk;
      
      if (!vkSettings?.groupId || !vkSettings?.token) {
        log('VK настройки неполные или отсутствуют', LOG_PREFIX);
        return null;
      }
      
      return {
        groupId: vkSettings.groupId,
        token: vkSettings.token
      };
    } catch (error) {
      log(`Ошибка получения настроек кампании: ${error}`, LOG_PREFIX);
      return null;
    }
  }
  
  /**
   * Получает URL для загрузки клипа в VK (clips.getUploadServer)
   */
  private async getClipsUploadServer(
    accessToken: string,
    groupId: string
  ): Promise<{ uploadUrl: string }> {
    const cleanGroupId = groupId.replace('club', '').replace('-', '');
    
    log(`Запрашиваю clips.getUploadServer для группы ${cleanGroupId}`, LOG_PREFIX);
    
    const response = await axios.post(
      'https://api.vk.com/method/clips.getUploadServer',
      new URLSearchParams({
        group_id: cleanGroupId,
        access_token: accessToken,
        v: VK_API_VERSION,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    
    log(`VK clips.getUploadServer response: hasUploadUrl=${!!response.data?.response?.upload_url}, error=${response.data?.error ? JSON.stringify(response.data.error) : 'нет'}`, LOG_PREFIX);
    
    if (response.data.error) {
      const errorCode = response.data.error.error_code;
      const errorMsg = response.data.error.error_msg;
      
      // Проверяем специфичные ошибки
      if (errorCode === 15) {
        throw new Error(`Доступ к Clips API запрещён. Проверьте права токена (scope: clips). Ошибка: ${errorMsg}`);
      }
      if (errorCode === 30) {
        throw new Error(`Профиль закрыт. Публикация клипов недоступна. Ошибка: ${errorMsg}`);
      }
      throw new Error(`VK API Error [${errorCode}]: ${errorMsg}`);
    }
    
    const data = response.data.response;
    return {
      uploadUrl: data.upload_url
    };
  }
  
  /**
   * Сохраняет загруженный клип (clips.save)
   */
  private async saveClip(
    accessToken: string,
    groupId: string,
    uploadResult: any,
    description: string
  ): Promise<{ clipId: string; ownerId: string; videoUrl: string }> {
    const cleanGroupId = groupId.replace('club', '').replace('-', '');
    
    log(`Сохраняю клип через clips.save. Upload result keys: ${Object.keys(uploadResult || {}).join(', ')}`, LOG_PREFIX);
    
    const params: Record<string, string> = {
      group_id: cleanGroupId,
      access_token: accessToken,
      v: VK_API_VERSION
    };
    
    // Добавляем параметры из upload result
    if (uploadResult.clip_id) {
      params.clip_id = String(uploadResult.clip_id);
    }
    if (uploadResult.video_id) {
      params.video_id = String(uploadResult.video_id);
    }
    
    // Описание клипа
    if (description) {
      params.description = description.substring(0, 2048);
    }
    
    const response = await axios.post(
      'https://api.vk.com/method/clips.save',
      new URLSearchParams(params),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    
    log(`VK clips.save response: ${JSON.stringify(response.data)}`, LOG_PREFIX);
    
    if (response.data.error) {
      throw new Error(`VK clips.save Error: ${response.data.error.error_msg}`);
    }
    
    const clip = response.data.response;
    const ownerId = String(clip.owner_id);
    const clipId = String(clip.id || clip.clip_id || clip.video?.id);
    
    // Формируем URL клипа
    const videoUrl = `https://vk.com/clip${ownerId}_${clipId}`;
    
    return {
      clipId,
      ownerId,
      videoUrl
    };
  }
  
  /**
   * Скачивает видео файл
   */
  private async downloadVideo(url: string): Promise<Buffer> {
    log(`Скачиваю видео: ${url}`, LOG_PREFIX);
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024
    });
    const sizeMB = (response.data.length / 1024 / 1024).toFixed(2);
    log(`Скачано ${sizeMB} MB`, LOG_PREFIX);
    return Buffer.from(response.data);
  }
  
  /**
   * Загружает видео на сервер клипов VK
   */
  private async uploadVideoToClips(
    uploadUrl: string,
    videoBuffer: Buffer
  ): Promise<any> {
    const form = new FormData();
    
    form.append('video_file', videoBuffer, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
    });
    
    const response = await axios.post(uploadUrl, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000
    });
    
    log(`VK Clips Upload response keys: ${Object.keys(response.data || {}).join(', ')}, error=${response.data?.error ? JSON.stringify(response.data.error) : 'нет'}`, LOG_PREFIX);
    
    // Проверяем ошибки в ответе
    if (response.data.error) {
      throw new Error(`Clips Upload Error: ${JSON.stringify(response.data.error)}`);
    }
    
    // Проверяем base64-encoded ошибку в upload_result (как в VK Stories)
    if (response.data.upload_result) {
      try {
        const decoded = Buffer.from(response.data.upload_result, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed.error || parsed.errcode) {
          throw new Error(`Clips Upload Error: ${parsed.error || parsed.message || JSON.stringify(parsed)}`);
        }
      } catch (parseError) {
        // Если не JSON или не base64 - игнорируем
      }
    }
    
    log(`Видео успешно загружено на сервер клипов VK`, LOG_PREFIX);
    
    // Возвращаем результат загрузки для использования в clips.save
    return response.data;
  }
  
  /**
   * Fallback: публикация как обычное видео через video.save
   */
  private async publishAsVideo(
    content: VKClipsContent,
    vkSettings: VKSettings,
    description: string
  ): Promise<VKClipsPublishResult> {
    try {
      const cleanGroupId = vkSettings.groupId.replace('club', '').replace('-', '');
      
      log(`Fallback: Публикуем как video.save для группы ${cleanGroupId}`, LOG_PREFIX);
      
      // 1. Получаем upload URL через video.save
      const saveResponse = await axios.post(
        'https://api.vk.com/method/video.save',
        new URLSearchParams({
          group_id: cleanGroupId,
          name: content.title || 'Видео',
          description: description.substring(0, 2048),
          is_private: '0',
          wallpost: '0',
          access_token: vkSettings.token,
          v: VK_API_VERSION,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      if (saveResponse.data.error) {
        throw new Error(`video.save Error: ${saveResponse.data.error.error_msg}`);
      }
      
      const saveData = saveResponse.data.response;
      const uploadUrl = saveData.upload_url;
      
      // 2. Скачиваем видео
      const videoBuffer = await this.downloadVideo(content.video_url!);
      
      // 3. Загружаем видео
      const form = new FormData();
      form.append('video_file', videoBuffer, {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      });
      
      await axios.post(uploadUrl, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000
      });
      
      const videoId = String(saveData.video_id);
      const ownerId = String(saveData.owner_id);
      const videoUrl = `https://vk.com/video${ownerId}_${videoId}`;
      
      log(`Fallback video.save успешно: ${videoUrl}`, LOG_PREFIX);
      
      return {
        success: true,
        videoId,
        ownerId,
        videoUrl
      };
      
    } catch (error: any) {
      log(`Fallback video.save ошибка: ${error.message}`, LOG_PREFIX);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Обновляет статус контента в Directus с сохранением в social_platforms
   */
  private async updateContentStatus(
    contentId: string,
    videoId: string,
    videoUrl: string,
    ownerId: string,
    authToken?: string
  ): Promise<void> {
    try {
      const token = authToken || process.env.DIRECTUS_STATIC_TOKEN;
      
      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const currentContent = contentResponse.data.data;
      const currentSocialPlatforms = currentContent.social_platforms || {};
      
      const publishedAt = new Date().toISOString();
      const vkData = {
        postId: videoId,
        status: 'published',
        postUrl: videoUrl,
        platform: 'vk',
        publishedAt: publishedAt,
        type: 'clip',
        ownerId: ownerId
      };
      
      const updatedSocialPlatforms = {
        ...currentSocialPlatforms,
        vk: vkData
      };
      
      await directusApi.patch(`/items/campaign_content/${contentId}`, {
        status: 'published',
        published_at: publishedAt,
        post_url: videoUrl,
        social_platforms: updatedSocialPlatforms
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      log(`Статус контента обновлён, social_platforms.vk сохранён: ${JSON.stringify(vkData)}`, LOG_PREFIX);
    } catch (error) {
      log(`Ошибка обновления статуса: ${error}`, LOG_PREFIX);
    }
  }
}

export const vkClipsService = new VKClipsService();
