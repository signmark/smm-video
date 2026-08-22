/**
 * TikTok Content Posting Service
 * 
 * Логика публикации видео в TikTok.
 * В текущем релизе TikTok не планируется.
 * 
 * API Documentation: https://developers.tiktok.com/doc/content-posting-api-get-started
 */

import axios from 'axios';
import { getRequiredServiceUrl } from "../../config/service-urls";
import { trackExternalCall, isTiktokApiError } from '../../utils/external-call';
import { BaseSocialService, TokenValidationResult } from './base-service';
import { CampaignContent, SocialMediaSettings } from '@shared/schema';

/**
 * Очищает caption для использования как title в TikTok API.
 * TikTok отклоняет посты с URL, чрезмерными хэштегами или запрещённым контентом в title.
 */
function sanitizeTikTokTitle(caption: string, maxLen = 150): string {
  let text = caption
    // Убираем HTML-теги
    .replace(/<[^>]*>/g, ' ')
    // Убираем URL-ы (http/https/www)
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/www\.[^\s]+/gi, '')
    // Убираем хэштеги
    .replace(/#\S+/g, '')
    // Сворачиваем лишние пробелы
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) text = 'Video';
  return text.substring(0, maxLen);
}

export interface TikTokPostOptions {
  accessToken: string;
  videoUrl?: string;         // URL для PULL_FROM_URL
  videoBuffer?: Buffer;      // Бинарные данные для FILE_UPLOAD
  videoSize?: number;        // Размер видео в байтах
  caption: string;           // Описание (макс 2200 символов)
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  videoCoverTimestampMs?: number;  // Таймстамп для обложки
  brandContentToggle?: boolean;     // Брендированный контент
  brandOrganicToggle?: boolean;     // Органический брендовый контент
}

export interface TikTokPublishResult {
  success: boolean;
  publishId?: string;
  postId?: string;
  error?: string;
  status?: 'PROCESSING' | 'PUBLISHED' | 'FAILED';
}

export class TikTokService extends BaseSocialService {
  private static readonly BASE_URL = 'https://open.tiktokapis.com/v2';
  
  constructor() {
    super('tiktok');
  }

  /**
   * Реализация метода публикации контента под единый интерфейс
   */
  async publishContent(
    content: CampaignContent,
    campaignSettings: SocialMediaSettings,
    userId: string
  ): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const settings = (campaignSettings as any).tiktok;
    const token = settings?.accessToken || settings?.token;
    
    if (!token) {
      return { success: false, error: 'TikTok token not found in settings' };
    }

    if (!content.videoUrl && !content.video_url) {
      return { success: false, error: 'TikTok requires a video URL' };
    }

    const result = await this.initVideoPostFromUrl({
      accessToken: token,
      videoUrl: content.videoUrl || content.video_url || undefined,
      caption: content.content || content.title || ''
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { 
      success: true, 
      postUrl: `https://www.tiktok.com/publish/${result.publishId}` // Placeholder URL while processing
    };
  }

  /**
   * Проверяет валидность TikTok токена
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const token = settings.accessToken || settings.token;
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // Проверяем через user info endpoint
      const response = await trackExternalCall(
        'tiktok',
        'user.info',
        () => axios.get(`${TikTokService.BASE_URL}/user/info/`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: { fields: 'open_id,display_name' }
        }),
        { isApiError: isTiktokApiError }
      );

      if (response.data.error?.code !== 'ok') {
        return { isValid: false, error: response.data.error.message };
      }

      return { isValid: true };
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message;
      return { isValid: false, error: msg };
    }
  }

  /**
   * Инициирует публикацию видео через Direct Post API
   * Использует PULL_FROM_URL (TikTok скачивает видео по URL)
   */
  async initVideoPostFromUrl(options: TikTokPostOptions): Promise<TikTokPublishResult> {
    if (!options.videoUrl) {
      return { success: false, error: 'videoUrl is required for PULL_FROM_URL' };
    }

    try {
      const response = await trackExternalCall(
        'tiktok',
        'post.publish.video.init',
        () => axios.post(
          `${TikTokService.BASE_URL}/post/publish/video/init/`,
          {
            post_info: {
              title: sanitizeTikTokTitle(options.caption),
              description: options.caption.substring(0, 2200),  // Full description
              privacy_level: options.privacyLevel || 'SELF_ONLY',
              disable_comment: options.disableComment || false,
              disable_duet: options.disableDuet || false,
              disable_stitch: options.disableStitch || false,
              video_cover_timestamp_ms: options.videoCoverTimestampMs || 0,
              brand_content_toggle: options.brandContentToggle || false,
              brand_organic_toggle: options.brandOrganicToggle || false
            },
            source_info: {
              source: 'PULL_FROM_URL',
              video_url: options.videoUrl
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${options.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        ),
        { isApiError: isTiktokApiError }
      );

      const data = response.data;
      
      if (data.error?.code !== 'ok') {
        return {
          success: false,
          error: data.error?.message || 'Unknown error'
        };
      }

      return {
        success: true,
        publishId: data.data?.publish_id,
        status: 'PROCESSING'
      };
    } catch (error: any) {
      console.error('[tiktok-service] Error initiating post:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Инициирует публикацию видео через FILE_UPLOAD
   * Возвращает URL для загрузки чанков
   */
  async initVideoPostUpload(options: TikTokPostOptions): Promise<{
    success: boolean;
    publishId?: string;
    uploadUrl?: string;
    error?: string;
  }> {
    if (!options.videoSize) {
      return { success: false, error: 'videoSize is required for FILE_UPLOAD' };
    }

    // Размер чанка: 5-64 MB, последний чанк до 128 MB
    const chunkSize = Math.min(options.videoSize, 10 * 1024 * 1024); // 10 MB

    try {
      const response = await trackExternalCall(
        'tiktok',
        'post.publish.video.init.fileupload',
        () => axios.post(
          `${TikTokService.BASE_URL}/post/publish/video/init/`,
          {
            post_info: {
              title: sanitizeTikTokTitle(options.caption),
              description: options.caption.substring(0, 2200),  // Full description
              privacy_level: options.privacyLevel || 'SELF_ONLY',
              disable_comment: options.disableComment || false,
              disable_duet: options.disableDuet || false,
              disable_stitch: options.disableStitch || false
            },
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: options.videoSize!,
              chunk_size: chunkSize,
              total_chunk_count: Math.ceil(options.videoSize! / chunkSize)
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${options.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        ),
        { isApiError: isTiktokApiError }
      );

      const data = response.data;

      if (data.error?.code !== 'ok') {
        return {
          success: false,
          error: data.error?.message || 'Unknown error'
        };
      }

      return {
        success: true,
        publishId: data.data?.publish_id,
        uploadUrl: data.data?.upload_url
      };
    } catch (error: any) {
      console.error('[tiktok-service] Error initiating upload:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Проверяет статус публикации
   */
  async checkPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishResult> {
    try {
      const response = await trackExternalCall(
        'tiktok',
        'post.publish.status.fetch',
        () => axios.post(
          `${TikTokService.BASE_URL}/post/publish/status/fetch/`,
          { publish_id: publishId },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        ),
        { isApiError: isTiktokApiError }
      );

      const data = response.data;

      if (data.error?.code !== 'ok') {
        return {
          success: false,
          error: data.error?.message || 'Unknown error'
        };
      }

      const status = data.data?.status;
      
      return {
        success: status === 'PUBLISH_COMPLETE',
        publishId,
        postId: data.data?.publicaly_available_post_id?.[0],
        status: status === 'PUBLISH_COMPLETE' ? 'PUBLISHED' : 
                status === 'FAILED' ? 'FAILED' : 'PROCESSING'
      };
    } catch (error: any) {
      console.error('[tiktok-service] Error checking status:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Публикует видео через FILE_UPLOAD (скачивает видео и грузит чанками).
   * Используется как основной метод — не требует верификации домена.
   */
  async publishByFileUpload(
    options: TikTokPostOptions,
    maxPollAttempts = 30,
    pollIntervalMs = 4000
  ): Promise<{ success: boolean; publishId?: string; postUrl?: string; error?: string }> {
    if (!options.videoUrl) {
      return { success: false, error: 'TikTok: URL видео не указан' };
    }

    let videoUrl = options.videoUrl;
    if (!videoUrl.startsWith('http')) {
      const directusUrl = getRequiredServiceUrl('DIRECTUS_URL');
      videoUrl = `${directusUrl}/assets/${videoUrl}`;
    }

    console.error(`[tiktok-service] FILE_UPLOAD: скачиваем видео ${videoUrl.substring(0, 80)}`);

    // Скачиваем видео в память
    let videoBuffer: Buffer;
    try {
      const dlResp = await trackExternalCall(
        'tiktok',
        'video.download',
        () => axios.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: 500 * 1024 * 1024 // 500 MB max
        }),
        { isApiError: isTiktokApiError }
      );
      videoBuffer = Buffer.from(dlResp.data);
    } catch (err: any) {
      return { success: false, error: `Ошибка скачивания видео: ${err.message}` };
    }

    const videoSize = videoBuffer.length;
    console.error(`[tiktok-service] Видео скачано: ${(videoSize / 1024 / 1024).toFixed(1)} MB`);

    // TikTok chunk limits: min 5MB per chunk (except last), max 64MB
    const CHUNK_SIZE = Math.min(64 * 1024 * 1024, videoSize);
    const totalChunks = Math.ceil(videoSize / CHUNK_SIZE);

    // Инициализируем FILE_UPLOAD
    let initData: any;
    try {
      const initResp = await trackExternalCall(
        'tiktok',
        'post.publish.video.init.fileupload',
        () => axios.post(
          `${TikTokService.BASE_URL}/post/publish/video/init/`,
          {
            post_info: {
              title: sanitizeTikTokTitle(options.caption),
              privacy_level: options.privacyLevel || 'SELF_ONLY',
              disable_comment: options.disableComment || false,
              disable_duet: options.disableDuet || false,
              disable_stitch: options.disableStitch || false,
              video_cover_timestamp_ms: options.videoCoverTimestampMs || 1000
            },
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: videoSize,
              chunk_size: CHUNK_SIZE,
              total_chunk_count: totalChunks
            }
          },
          {
            headers: {
              Authorization: `Bearer ${options.accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8'
            }
          }
        ),
        { isApiError: isTiktokApiError }
      );
      initData = initResp.data;
    } catch (err: any) {
      const errData = err.response?.data?.error;
      const errCode = errData?.code || 'UNKNOWN';
      const msg = errData?.message || err.message;
      console.error(`[tiktok-service] FILE_UPLOAD init failed: code=${errCode}, message=${msg}, status=${err.response?.status}, body=${JSON.stringify(err.response?.data)}`);
      return { success: false, error: `TikTok init error [${errCode}]: ${msg}` };
    }

    if (initData.error?.code && initData.error.code !== 'ok') {
      const friendlyErrors = this.getErrorMessages();
      const errCode = initData.error.code;
      const friendly = friendlyErrors[errCode];
      console.error(`[tiktok-service] FILE_UPLOAD init rejected: code=${errCode}, message=${initData.error.message}`);
      return { success: false, error: friendly || `TikTok init [${errCode}]: ${initData.error.message}` };
    }

    const publishId: string = initData.data?.publish_id;
    const uploadUrl: string = initData.data?.upload_url;

    if (!publishId || !uploadUrl) {
      return { success: false, error: 'TikTok: не получены publish_id или upload_url' };
    }

    console.error(`[tiktok-service] publish_id=${publishId}, upload_url получен, chunks=${totalChunks}`);

    // Загружаем чанки
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, videoSize);
      const chunk = videoBuffer.slice(start, end);

      try {
        await trackExternalCall(
          'tiktok',
          'upload.chunk',
          () => axios.put(uploadUrl, chunk, {
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Range': `bytes ${start}-${end - 1}/${videoSize}`,
              'Content-Length': chunk.length
            },
            maxBodyLength: 70 * 1024 * 1024,
            timeout: 120000
          }),
          { isApiError: isTiktokApiError }
        );
        console.error(`[tiktok-service] Чанк ${i + 1}/${totalChunks} загружен (${(chunk.length / 1024 / 1024).toFixed(1)} MB)`);
      } catch (err: any) {
        const msg = err.response?.data?.message || err.message;
        return { success: false, publishId, error: `Ошибка загрузки чанка ${i + 1}: ${msg}` };
      }
    }

    console.error(`[tiktok-service] Все чанки загружены, поллим статус...`);

    // Поллим статус
    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const statusResult = await this.checkPublishStatus(options.accessToken, publishId);
      console.error(`[tiktok-service] poll ${attempt}/${maxPollAttempts}: status=${statusResult.status}`);

      if (statusResult.status === 'PUBLISHED') {
        const postUrl = statusResult.postId
          ? `https://www.tiktok.com/video/${statusResult.postId}`
          : 'https://www.tiktok.com';
        return { success: true, publishId, postUrl };
      }
      if (statusResult.status === 'FAILED') {
        return { success: false, publishId, error: statusResult.error || 'TikTok publish failed' };
      }
    }

    // Всё ещё обрабатывается на стороне TikTok
    console.error(`[tiktok-service] Таймаут поллинга — видео ещё обрабатывается, publishId=${publishId}`);
    return { success: true, publishId, postUrl: undefined };
  }

  /**
   * Публикует видео и дожидается завершения.
   * Пробует FILE_UPLOAD (не требует верификации домена).
   * PULL_FROM_URL оставлен как fallback если передан флаг usePull=true.
   */
  async publishAndWait(
    options: TikTokPostOptions,
    maxPollAttempts = 20,
    pollIntervalMs = 3000
  ): Promise<{ success: boolean; publishId?: string; postUrl?: string; error?: string }> {
    if (!options.videoUrl) {
      return { success: false, error: 'TikTok: URL видео не указан (требуется video_url)' };
    }
    return this.publishByFileUpload(options, maxPollAttempts, pollIntervalMs);
  }

  /**
   * Загружает видео как черновик (для редактирования пользователем)
   */
  async uploadToDraft(options: TikTokPostOptions): Promise<TikTokPublishResult> {
    if (!options.videoUrl) {
      return { success: false, error: 'videoUrl is required' };
    }

    try {
      const response = await trackExternalCall(
        'tiktok',
        'post.publish.inbox.video.init',
        () => axios.post(
          `${TikTokService.BASE_URL}/post/publish/inbox/video/init/`,
          {
            source_info: {
              source: 'PULL_FROM_URL',
              video_url: options.videoUrl
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${options.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        ),
        { isApiError: isTiktokApiError }
      );

      const data = response.data;

      if (data.error?.code !== 'ok') {
        return {
          success: false,
          error: data.error?.message || 'Unknown error'
        };
      }

      return {
        success: true,
        publishId: data.data?.publish_id,
        status: 'PROCESSING'
      };
    } catch (error: any) {
      console.error('[tiktok-service] Error uploading to draft:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Получает список ошибок публикации
   */
  getErrorMessages(): Record<string, string> {
    return {
      'spam_risk_too_many_pending_share': 'Слишком много ожидающих публикаций. Попробуйте позже.',
      'spam_risk_user_banned_from_posting': 'Аккаунт заблокирован для публикации.',
      'reached_active_user_cap': 'Достигнут лимит активных пользователей API.',
      'unaudited_client_can_only_post_to_private_accounts': 'Без аудита можно публиковать только приватный контент.',
      'url_ownership_unverified': 'URL видео не верифицирован. Добавьте домен в настройки приложения.',
      'duration_check_failed': 'Длительность видео превышает лимит аккаунта.',
      'picture_check_failed': 'Ошибка проверки изображения.',
      'video_check_failed': 'Видео не прошло проверку (формат/разрешение).'
    };
  }
}

export const tiktokService = new TikTokService();
