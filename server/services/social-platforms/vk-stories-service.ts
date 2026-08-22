/**
 * VK Stories Publishing Service
 * 
 * Сервис для публикации Stories в ВКонтакте
 * Работает по аналогии с Instagram Stories
 */

import axios from 'axios';
import { trackExternalCall, isVkApiError } from '../../utils/external-call';
import FormData from 'form-data';
import { log } from '../../utils/logger';
import { formatVkErrorMessage, createVkApiError } from '../../utils/vk-error';
import { directusApi } from '../../directus';
import { TokenValidationResult } from './base-service';
import { generateStoriesImageServer } from '../stories-image-generator';
import StoriesMediaService from '../stories-media-service';
import { ADDITIONAL_MEDIA_TYPES } from '../../../shared/stories-constants';

const VK_API_VERSION = '5.199';
const LOG_PREFIX = 'vk-stories';

export interface VKStoriesPublishResult {
  success: boolean;
  storyId?: string;
  storyUrl?: string;
  error?: string;
}

export interface VKStoriesContent {
  id: string;
  campaign_id: string;
  image_url?: string;
  video_url?: string;
  content_type?: string;
  title?: string;
  metadata?: string | { textOverlays?: any[] };
}

export interface VKSettings {
  groupId: string;
  token: string;
}

/**
 * VK Stories Publisher Service
 */
export class VKStoriesService {
  
  /**
   * Проверяет валидность VK токена
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const token = settings.token;
    const groupId = settings.groupId;
    
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // Проверяем токен через users.get
      const response = await trackExternalCall('vk', 'users.get', () => axios.post('https://api.vk.com/method/users.get', 
        new URLSearchParams({
          access_token: token,
          v: VK_API_VERSION
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      ), { isApiError: isVkApiError });

      if (response.data.error) {
        return { isValid: false, error: response.data.error.error_msg };
      }

      // Если есть groupId, проверяем доступ к группе
      if (groupId) {
        const cleanId = groupId.replace('club', '').replace('-', '');
        const groupsRes = await trackExternalCall('vk', 'groups.getById', () => axios.post('https://api.vk.com/method/groups.getById', 
          new URLSearchParams({
            group_id: cleanId,
            access_token: token,
            v: VK_API_VERSION
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        ), { isApiError: isVkApiError });
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
   * Публикует контент как Story в VK
   */
  async publishStory(
    contentId: string,
    authToken?: string,
    prefetchedContent?: any
  ): Promise<VKStoriesPublishResult> {
    try {
      console.log(`[VK-STORIES] 🚀 Начинаю публикацию VK Story для контента ${contentId}`);
      
      // 1. Получить контент (используем prefetched если есть)
      const content = prefetchedContent || await this.getContent(contentId, authToken);
      if (!content) {
        console.error(`[VK-STORIES] ❌ Контент не найден: ${contentId}`);
        return { success: false, error: 'Контент не найден' };
      }
      
      const campaignId = content.campaign_id;
      if (!campaignId) {
        console.error(`[VK-STORIES] ❌ У контента нет campaign_id`);
        return { success: false, error: 'У контента нет campaign_id' };
      }

      // 2. Получить VK настройки из кампании
      console.log(`[VK-STORIES] 🔑 Получаю настройки VK для кампании ${campaignId}...`);
      const vkSettings = await this.getVKSettings(campaignId, authToken);
      if (!vkSettings) {
        console.error(`[VK-STORIES] ❌ Настройки VK не найдены`);
        return { success: false, error: 'VK настройки не найдены в кампании' };
      }
      
      // 3. Определить медиа URL
      let mediaUrl = content.video_url || content.image_url;
      const isVideo = !!content.video_url;
      
      // 3.1. Проверить наличие сгенерированного медиа в additional_media
      console.log(`[VK-STORIES] 🔍 Проверяю наличие сгенерированного контента в additional_media...`);
      const generatedMediaUrl = await StoriesMediaService.getMediaFromAdditionalMedia(
        contentId,
        isVideo ? ADDITIONAL_MEDIA_TYPES.GENERATED_VIDEO : ADDITIONAL_MEDIA_TYPES.GENERATED_IMAGE,
        authToken || process.env.DIRECTUS_STATIC_TOKEN || ''
      );

      if (generatedMediaUrl) {
        console.log(`[VK-STORIES] ✅ Использую сгенерированный контент: ${generatedMediaUrl}`);
        mediaUrl = generatedMediaUrl;
      }
      
      if (!mediaUrl) {
        return { success: false, error: 'Нет медиа файла (video_url или image_url)' };
      }
      
      console.log(`[VK-STORIES] 🎥 Тип контента: ${isVideo ? 'ВИДЕО' : 'ФОТО'}`);
      
      // 3.2. Подготовка Buffer
      let mediaBuffer: Buffer;
      try {
        console.log(`[VK-STORIES] 📥 Скачиваю медиа по ссылке: ${mediaUrl}`);
        mediaBuffer = await this.downloadMedia(mediaUrl);
      } catch (downloadError: any) {
        console.error(`[VK-STORIES] ❌ Ошибка скачивания медиа: ${downloadError.message}`);
        return { success: false, error: `Ошибка скачивания медиа: ${downloadError.message}` };
      }
      
      // 4. Получить upload server
      console.log(`[VK-STORIES] 🌐 Запрашиваю сервер загрузки VK...`);
      const uploadUrl = await this.getUploadServer(vkSettings.token, vkSettings.groupId, isVideo);
      
      // 6. Загрузить в VK
      console.log(`[VK-STORIES] 📤 Загружаю файл в VK (${mediaBuffer.length} байт)...`);
      const uploadResult = await this.uploadMedia(uploadUrl, mediaBuffer, isVideo);
      
      // 7. Сохранить Story
      console.log(`[VK-STORIES] 💾 Сохраняю Story в VK...`);
      const { storyId, storyUrl, ownerId } = await this.saveStory(vkSettings.token, uploadResult);
      
      // 8. Обновить статус в Directus
      console.log(`[VK-STORIES] 📝 Обновляю статус в Directus...`);
      await this.updateContentStatus(contentId, storyId, storyUrl, ownerId, authToken);
      
      console.log(`[VK-STORIES] ✨ VK Story опубликована успешно! URL: ${storyUrl}`);
      
      return {
        success: true,
        storyId,
        storyUrl
      };
      
    } catch (error: any) {
      console.error(`[VK-STORIES] ❌ КРИТИЧЕСКАЯ ОШИБКА:`, error);
      return {
        success: false,
        error: error.message || 'Неизвестная ошибка'
      };
    }
  }
  
  /**
   * Получает контент из Directus
   */
  private async getContent(contentId: string, authToken?: string): Promise<VKStoriesContent | null> {
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
   * Получает URL для загрузки Story в VK
   */
  private async getUploadServer(
    accessToken: string,
    groupId: string,
    isVideo: boolean
  ): Promise<string> {
    const method = isVideo ? 'stories.getVideoUploadServer' : 'stories.getPhotoUploadServer';
    const cleanGroupId = groupId.replace('club', '').replace('-', '');
    
    const response = await trackExternalCall('vk', 'stories.getUploadServer', () => axios.post(
      `https://api.vk.com/method/${method}`,
      new URLSearchParams({
        group_id: cleanGroupId,
        add_to_news: '1',
        access_token: accessToken,
        v: VK_API_VERSION,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    ), { isApiError: isVkApiError });
    
    if (response.data.error) {
      throw new Error(`VK API Error: ${response.data.error.error_msg}`);
    }
    
    return response.data.response.upload_url;
  }
  
  /**
   * Скачивает медиа файл
   */
  private async downloadMedia(url: string): Promise<Buffer> {
    const response = await trackExternalCall('vk', 'fetch.media', () => axios.get(url, { responseType: 'arraybuffer' }), { isApiError: isVkApiError });
    log(`Скачано ${(response.data.length / 1024 / 1024).toFixed(2)} MB`, LOG_PREFIX);
    return Buffer.from(response.data);
  }
  
  /**
   * Загружает медиа в VK
   */
  private async uploadMedia(
    uploadUrl: string,
    mediaBuffer: Buffer,
    isVideo: boolean
  ): Promise<string> {
    const form = new FormData();
    const fieldName = isVideo ? 'video_file' : 'file';
    const fileName = isVideo ? 'story.mp4' : 'story.jpg';
    
    form.append(fieldName, mediaBuffer, {
      filename: fileName,
      contentType: isVideo ? 'video/mp4' : 'image/jpeg',
    });
    
    const response = await trackExternalCall('vk', 'upload.stories', () => axios.post(uploadUrl, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }), { isApiError: isVkApiError });
    
    log(`VK Upload response keys: ${Object.keys(response.data || {}).join(', ')}, error=${response.data?.error ? JSON.stringify(response.data.error) : 'нет'}`, LOG_PREFIX);
    
    if (response.data.error) {
      throw createVkApiError('VK Stories Upload', response.data.error, response.data, response.status);
    }
    
    // VK возвращает upload_result в разных местах в зависимости от типа
    // Для фото: response.data.response.story[0].upload_result
    // Для видео: response.data.response.video[0].upload_result
    // Иногда напрямую: response.data.upload_result
    const responseData = response.data.response || response.data;
    
    let uploadResult: string | undefined;
    
    if (isVideo && responseData.video?.[0]?.upload_result) {
      uploadResult = responseData.video[0].upload_result;
    } else if (!isVideo && responseData.story?.[0]?.upload_result) {
      uploadResult = responseData.story[0].upload_result;
    } else if (responseData.upload_result) {
      uploadResult = responseData.upload_result;
    } else if (response.data.upload_result) {
      uploadResult = response.data.upload_result;
    }
    
    if (!uploadResult) {
      throw new Error('Не удалось получить upload_result из ответа VK');
    }
    
    // Проверяем на base64-закодированную ошибку в upload_result
    // Формат: "go_upload:eyJlcnJvcl9jb2RlIjo0NjAzLC...}" где base64 часть содержит JSON с ошибкой
    if (uploadResult.startsWith('go_upload:')) {
      const base64Part = uploadResult.substring('go_upload:'.length);
      try {
        const decodedJson = Buffer.from(base64Part, 'base64').toString('utf-8');
        const decoded = JSON.parse(decodedJson);
        if (decoded.error_code || decoded.error_msg) {
          log(`VK Upload вернул ошибку: ${decodedJson}`, LOG_PREFIX);
          throw new Error(`VK Upload Error ${decoded.error_code}: ${decoded.error_msg || 'Upload failed'}`);
        }
      } catch (parseError: any) {
        // Если это наша ошибка - пробрасываем её
        if (parseError.message?.includes('VK Upload Error')) {
          throw parseError;
        }
        // Иначе это ошибка парсинга, игнорируем - возможно нормальный результат
        log(`Не удалось распарсить upload_result как ошибку: ${parseError.message}`, LOG_PREFIX);
      }
    }
    
    log(`Upload result получен успешно`, LOG_PREFIX);
    return uploadResult;
  }
  
  /**
   * Сохраняет Story в VK
   */
  private async saveStory(
    accessToken: string,
    uploadResult: string
  ): Promise<{ storyId: string; storyUrl: string; ownerId: string }> {
    const response = await trackExternalCall('vk', 'stories.save', () => axios.post(
      'https://api.vk.com/method/stories.save',
      new URLSearchParams({
        upload_results: uploadResult,
        access_token: accessToken,
        v: VK_API_VERSION,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    ), { isApiError: isVkApiError });
    
    log(`VK stories.save response: ${JSON.stringify(response.data)}`, LOG_PREFIX);
    
    if (response.data.error) {
      throw new Error(`VK API Error: ${response.data.error.error_msg}`);
    }
    
    // VK может вернуть story в разных форматах:
    // - response.items[0] (стандартный)
    // - response.story[0] (альтернативный)
    // - response[0] (массив напрямую)
    const responseData = response.data.response;
    
    let storyItem: any = null;
    
    if (responseData?.items?.[0]) {
      storyItem = responseData.items[0];
    } else if (responseData?.story?.[0]) {
      storyItem = responseData.story[0];
    } else if (Array.isArray(responseData) && responseData[0]) {
      storyItem = responseData[0];
    }
    
    if (!storyItem || !storyItem.id) {
      log(`Ответ VK не содержит данных о Story: ${JSON.stringify(response.data)}`, LOG_PREFIX);
      throw new Error('VK не вернул данные Story. Возможно загрузка не удалась.');
    }
    
    const storyId = String(storyItem.id);
    const ownerId = storyItem.owner_id ? String(storyItem.owner_id) : '';
    
    // Правильный формат URL: https://vk.com/story{owner_id}_{story_id}
    // Если owner_id отсутствует, возвращаем общую ссылку на ленту
    const storyUrl = ownerId 
      ? `https://vk.com/story${ownerId}_${storyId}`
      : 'https://vk.com/feed';
    
    log(`Story сохранена: ID=${storyId}, ownerId=${ownerId}, URL=${storyUrl}`, LOG_PREFIX);
    return { storyId, storyUrl, ownerId };
  }
  
  /**
   * Обновляет статус контента в Directus с сохранением в social_platforms
   */
  private async updateContentStatus(
    contentId: string,
    storyId: string,
    storyUrl: string,
    ownerId: string,
    authToken?: string
  ): Promise<void> {
    try {
      const token = authToken || process.env.DIRECTUS_STATIC_TOKEN;
      
      // Сначала получаем текущие social_platforms
      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const currentContent = contentResponse.data.data;
      
      // ВАЖНО: social_platforms должен быть объектом, не массивом
      // Если это массив или содержит числовые ключи (мусор от предыдущих ошибок), игнорируем его
      let currentSocialPlatforms = currentContent.social_platforms || {};
      
      if (Array.isArray(currentSocialPlatforms)) {
        log(`⚠️ social_platforms был массивом, сбрасываем в пустой объект`, LOG_PREFIX);
        currentSocialPlatforms = {};
      } else if (typeof currentSocialPlatforms === 'object') {
        // Удаляем мусорные числовые ключи типа "0", "1" и т.д.
        const cleanedPlatforms: Record<string, any> = {};
        for (const key of Object.keys(currentSocialPlatforms)) {
          if (isNaN(Number(key))) {
            cleanedPlatforms[key] = currentSocialPlatforms[key];
          } else {
            log(`⚠️ Удаляем мусорный ключ "${key}" из social_platforms`, LOG_PREFIX);
          }
        }
        currentSocialPlatforms = cleanedPlatforms;
      }
      
      // Формируем данные VK в стандартном формате
      const publishedAt = new Date().toISOString();
      const vkData = {
        postId: storyId,
        status: 'published',
        postUrl: storyUrl,
        platform: 'vk',
        publishedAt: publishedAt,
        type: 'story',
        ownerId: ownerId
      };
      
      // Объединяем с существующими данными
      const updatedSocialPlatforms = {
        ...currentSocialPlatforms,
        vk: vkData
      };
      
      await directusApi.patch(`/items/campaign_content/${contentId}`, {
        status: 'published',
        published_at: publishedAt,
        post_url: storyUrl,
        social_platforms: updatedSocialPlatforms
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      log(`Статус контента обновлён на published, social_platforms.vk сохранён: ${JSON.stringify(vkData)}`, LOG_PREFIX);
    } catch (error) {
      log(`Ошибка обновления статуса: ${error}`, LOG_PREFIX);
    }
  }
}

// Экспортируем singleton instance
export const vkStoriesService = new VKStoriesService();
