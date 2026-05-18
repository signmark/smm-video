import axios from 'axios';
import FormData from 'form-data';
import { randomUUID } from 'crypto';
import { log } from '../../utils/logger';
import { storeTempVideo } from '../../utils/temp-video-store';
import { stripMarkdown } from '../../utils/strip-markdown';

const THREADS_API = 'https://graph.threads.net/v1.0';

/**
 * Загружает видео в Cloudinary и возвращает публичный Cloudinary URL.
 * Cloudinary глобально доступен для Meta серверов в отличие от beget.cloud и dev-доменов Replit.
 */
async function uploadVideoToCloudinary(buffer: Buffer, contentType: string, opId: string): Promise<string | null> {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

    const base64 = buffer.toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    const form = new FormData();
    form.append('file', dataUri);
    form.append('upload_preset', uploadPreset);
    form.append('resource_type', 'video');
    form.append('folder', 'threads-videos');

    const res = await axios.post(
      `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 180000,
        maxContentLength: 300 * 1024 * 1024,
        maxBodyLength: 300 * 1024 * 1024
      }
    );

    if (res.data?.secure_url) {
      log(`[${opId}] Видео загружено в Cloudinary: ${res.data.secure_url}`, 'threads-service');
      return res.data.secure_url;
    }
    return null;
  } catch (err: any) {
    log(`[${opId}] Cloudinary upload failed: ${err.response?.data?.error?.message || err.message}`, 'threads-service');
    return null;
  }
}

/**
 * Загружает изображение в Cloudinary и возвращает публичный URL.
 * Meta-серверы не могут получить доступ к российским S3 хранилищам.
 */
async function uploadImageToCloudinary(imageUrl: string, opId: string): Promise<string | null> {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

    log(`[${opId}] Скачиваем изображение для Cloudinary: ${imageUrl.substring(0, 80)}`, 'threads-service');
    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });
    const buffer = Buffer.from(resp.data);
    const contentType = (resp.headers['content-type'] as string) || 'image/jpeg';
    const base64 = buffer.toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    const form = new FormData();
    form.append('file', dataUri);
    form.append('upload_preset', uploadPreset);
    form.append('resource_type', 'image');
    form.append('folder', 'threads-images');

    const res = await axios.post(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
      }
    );

    if (res.data?.secure_url) {
      log(`[${opId}] Изображение загружено в Cloudinary: ${res.data.secure_url}`, 'threads-service');
      return res.data.secure_url;
    }
    return null;
  } catch (err: any) {
    log(`[${opId}] Cloudinary image upload failed: ${err.response?.data?.error?.message || err.message}`, 'threads-service');
    return null;
  }
}

/**
 * Скачивает видео с оригинального URL и возвращает публичный URL для Threads API.
 * Приоритет: Cloudinary → локальный прокси (smm.omemo.tech) → оригинал
 * Meta-серверы не могут получить доступ к российским S3 хранилищам и Replit dev-доменам.
 */
async function proxyVideoForThreads(videoUrl: string, opId: string): Promise<string> {
  log(`[${opId}] Скачиваем видео для проксирования: ${videoUrl.substring(0, 80)}`, 'threads-service');
  const resp = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 300 * 1024 * 1024
  });

  const buffer = Buffer.from(resp.data);
  const contentType = (resp.headers['content-type'] as string) || 'video/mp4';
  log(`[${opId}] Видео скачано (${(buffer.length / 1024 / 1024).toFixed(1)} MB), загружаем в Cloudinary...`, 'threads-service');

  // Пробуем Cloudinary — глобально доступен для Meta серверов
  const cloudinaryUrl = await uploadVideoToCloudinary(buffer, contentType, opId);
  if (cloudinaryUrl) {
    return cloudinaryUrl;
  }

  // Fallback: локальный прокси (работает только если APP_PUBLIC_URL задан — продакшн)
  const serverBaseUrl = process.env.APP_PUBLIC_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null);
  if (serverBaseUrl) {
    const id = randomUUID();
    storeTempVideo(id, buffer, contentType);
    const proxyUrl = `${serverBaseUrl}/api/video-temp/${id}`;
    log(`[${opId}] Cloudinary недоступен, используем локальный прокси: ${proxyUrl}`, 'threads-service');
    return proxyUrl;
  }

  log(`[${opId}] Нет доступного прокси, используем оригинальный URL (может не работать с Meta)`, 'threads-service');
  return videoUrl;
}
const THREADS_AUTH = 'https://graph.threads.net/oauth/access_token';
const THREADS_LONG_LIVED = 'https://graph.threads.net/access_token';

export interface ThreadsSettings {
  appId: string;
  appSecret: string;
  accessToken: string;
  threadsUserId: string;
  username?: string;
  setupCompletedAt?: string;
}

export interface ThreadsPublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  warning?: string;
}

class ThreadsService {
  async validateToken(settings: Partial<ThreadsSettings>): Promise<{ isValid: boolean; error?: string; username?: string; pendingReview?: boolean }> {
    if (!settings.accessToken) return { isValid: false, error: 'Токен отсутствует' };
    try {
      const res = await axios.get(`${THREADS_API}/me`, {
        params: { fields: 'id,username', access_token: settings.accessToken }
      });
      return { isValid: true, username: res.data.username };
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      const isPermissionError = msg?.includes('threads_basic') || msg?.includes('app review') || msg?.includes('Threads testers');
      if (isPermissionError) {
        return {
          isValid: true,
          pendingReview: true,
          username: settings.threadsUserId || '',
          error: undefined
        };
      }
      return { isValid: false, error: msg };
    }
  }

  async getUserId(accessToken: string): Promise<{ id: string; username: string }> {
    const res = await axios.get(`${THREADS_API}/me`, {
      params: { fields: 'id,username', access_token: accessToken }
    });
    return { id: res.data.id, username: res.data.username };
  }

  /**
   * Обновляет long-lived токен Threads (живёт 60 дней, refreshable до истечения)
   * Endpoint: GET https://graph.threads.net/refresh_access_token
   */
  async refreshLongLivedToken(accessToken: string): Promise<string> {
    try {
      const res = await axios.get('https://graph.threads.net/refresh_access_token', {
        params: {
          grant_type: 'th_refresh_token',
          access_token: accessToken
        },
        timeout: 10000
      });
      const newToken = res.data.access_token;
      if (newToken) {
        log(`refreshLongLivedToken: токен успешно обновлён (${String(newToken).substring(0, 20)}...)`, 'threads-service');
        return newToken;
      }
      return accessToken;
    } catch (err: any) {
      // Ошибка при refresh — используем оригинальный токен (он может ещё работать)
      log(`refreshLongLivedToken ERROR (используем оригинальный): ${err.response?.data?.error?.message || err.message}`, 'threads-service');
      return accessToken;
    }
  }

  async getLongLivedToken(shortToken: string, appId: string, appSecret: string): Promise<string> {
    try {
      log(`getLongLivedToken: appId=${appId}, token=${shortToken.substring(0, 20)}...`, 'threads-service');
      const res = await axios.get(THREADS_LONG_LIVED, {
        params: {
          grant_type: 'th_exchange_token',
          client_secret: appSecret,
          access_token: shortToken
        }
      });
      log(`getLongLivedToken success: token=${res.data.access_token?.substring(0, 20)}...`, 'threads-service');
      return res.data.access_token;
    } catch (err: any) {
      log(`getLongLivedToken ERROR ${err.response?.status}: ${JSON.stringify(err.response?.data)}`, 'threads-service');
      log(`getLongLivedToken: falling back to short-lived token`, 'threads-service');
      return shortToken;
    }
  }

  async exchangeCodeForToken(code: string, appId: string, appSecret: string, redirectUri: string): Promise<{ access_token: string; user_id?: string }> {
    log(`exchangeCodeForToken: appId=${appId}, redirectUri=${redirectUri}, code=${code.substring(0, 20)}...`, 'threads-service');
    try {
      const body = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      });
      const res = await axios.post(THREADS_AUTH, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      log(`exchangeCodeForToken success: ${JSON.stringify(res.data)}`, 'threads-service');
      return { access_token: res.data.access_token, user_id: res.data.user_id?.toString() };
    } catch (err: any) {
      log(`exchangeCodeForToken ERROR ${err.response?.status}: ${JSON.stringify(err.response?.data)}`, 'threads-service');
      throw err;
    }
  }

  /**
   * Sanitizes text for Threads API:
   * - Strips HTML tags
   * - Decodes HTML entities
   * - Truncates to 500 characters (Threads API limit)
   */
  private sanitizeThreadsText(raw: string): string {
    // Сначала убираем Markdown (**, *, __, ##, `code` и т.д.)
    let text = stripMarkdown(raw);
    // Strip HTML tags but preserve newlines from block elements
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    // Decode common HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–');
    // Collapse multiple spaces on same line (but preserve newlines)
    text = text.replace(/[^\S\n]+/g, ' ');
    // Collapse 3+ consecutive newlines into 2
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    // Truncate to 500 chars (Threads API limit)
    if (text.length > 500) {
      text = text.substring(0, 497) + '...';
    }
    return text;
  }

  async publishPost(settings: ThreadsSettings, content: {
    text: string;
    imageUrl?: string;
    videoUrl?: string;
  }): Promise<ThreadsPublishResult> {
    const opId = `threads_${Date.now()}`;
    let mediaType: string = 'TEXT';

    // Обновляем токен перед публикацией (токены живут 60 дней, нужно периодически обновлять)
    const freshToken = await this.refreshLongLivedToken(settings.accessToken);
    const { threadsUserId } = settings;
    const accessToken = freshToken;

    try {
      log(`[${opId}] Publishing to Threads for user ${threadsUserId}`, 'threads-service');

      // Sanitize text: strip HTML and enforce 500-char limit
      const cleanText = this.sanitizeThreadsText(content.text);
      log(`[${opId}] Text length after sanitize: ${cleanText.length} chars`, 'threads-service');

      let containerParams: Record<string, any> = {
        access_token: accessToken
      };

      if (content.videoUrl) {
        mediaType = 'VIDEO';
        // Проксируем видео через наш сервер (Meta не достигает российские S3)
        const proxiedVideoUrl = await proxyVideoForThreads(content.videoUrl, opId);
        containerParams = { ...containerParams, media_type: mediaType, video_url: proxiedVideoUrl, text: cleanText };
      } else if (content.imageUrl) {
        mediaType = 'IMAGE';
        // Проксируем изображение через Cloudinary — Meta не видит российские S3
        let finalImageUrl = content.imageUrl;
        const proxiedImageUrl = await uploadImageToCloudinary(content.imageUrl, opId);
        if (proxiedImageUrl) {
          finalImageUrl = proxiedImageUrl;
          log(`[${opId}] Using Cloudinary image URL for Threads`, 'threads-service');
        } else {
          log(`[${opId}] Cloudinary image upload failed, using original URL (may fail with Meta)`, 'threads-service');
        }
        containerParams = { ...containerParams, media_type: mediaType, image_url: finalImageUrl, text: cleanText };
      } else {
        mediaType = 'TEXT';
        containerParams = { ...containerParams, media_type: mediaType, text: cleanText };
      }

      log(`[${opId}] Step 1: Creating ${mediaType} container`, 'threads-service');
      const containerRes = await axios.post(
        `${THREADS_API}/${threadsUserId}/threads`,
        null,
        { params: containerParams }
      );

      const creationId = containerRes.data.id;
      if (!creationId) throw new Error('Не получен ID контейнера от Threads API');

      log(`[${opId}] Step 2: Waiting for container ${creationId} to be ready`, 'threads-service');

      if (mediaType === 'VIDEO') {
        // Threads нужно время для обработки видео — polling статуса
        const maxAttempts = 15;
        const pollInterval = 4000;
        let ready = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          try {
            const statusRes = await axios.get(`${THREADS_API}/${creationId}`, {
              params: { fields: 'status,error_message', access_token: accessToken }
            });
            const containerStatus = statusRes.data?.status;
            const containerError = statusRes.data?.error_message;
            log(`[${opId}] Container status attempt ${attempt}/${maxAttempts}: ${containerStatus}`, 'threads-service');
            if (containerStatus === 'FINISHED') {
              ready = true;
              break;
            }
            if (containerStatus === 'ERROR' || containerStatus === 'EXPIRED') {
              throw new Error(`Threads video container error: ${containerError || containerStatus}`);
            }
          } catch (pollErr: any) {
            if (pollErr.message?.startsWith('Threads video container')) throw pollErr;
            log(`[${opId}] Status poll error (attempt ${attempt}): ${pollErr.message}`, 'threads-service');
          }
        }
        if (!ready) {
          throw new Error('Threads video container did not become FINISHED in time');
        }
      }

      // Threads требует небольшую паузу перед публикацией для всех типов контейнеров
      if (mediaType !== 'VIDEO') {
        log(`[${opId}] Waiting 3s for container to be ready (Threads eventual consistency)`, 'threads-service');
        await new Promise(r => setTimeout(r, 3000));
      }

      log(`[${opId}] Step 3: Publishing container ${creationId}`, 'threads-service');
      const publishRes = await axios.post(
        `${THREADS_API}/${threadsUserId}/threads_publish`,
        null,
        { params: { creation_id: creationId, access_token: accessToken } }
      );

      const postId = publishRes.data.id;

      // Получаем permalink с коротким кодом (числовой ID в URL не работает)
      let postUrl = `https://www.threads.net/@${settings.username || threadsUserId}/post/${postId}`;
      try {
        const mediaInfoRes = await axios.get(`${THREADS_API}/${postId}`, {
          params: { fields: 'permalink', access_token: accessToken }
        });
        if (mediaInfoRes.data?.permalink) {
          postUrl = mediaInfoRes.data.permalink;
          log(`[${opId}] Got permalink from API: ${postUrl}`, 'threads-service');
        }
      } catch (permalinkErr: any) {
        log(`[${opId}] Could not get permalink, using fallback URL: ${permalinkErr.message}`, 'threads-service');
      }

      log(`[${opId}] Published successfully: ${postUrl}`, 'threads-service');
      return { success: true, postId, postUrl };
    } catch (err: any) {
      const meta = err.response?.data?.error;
      const rawMsg = meta?.message || err.response?.data?.message || err.message;
      const errCode = meta?.code || err.response?.status;
      const errSubcode = meta?.error_subcode || meta?.error_user_msg || '';
      const errType = meta?.type || '';
      const errMsg = rawMsg && rawMsg !== '' ? rawMsg : `HTTP ${err.response?.status || 'network'}: ${JSON.stringify(err.response?.data || err.code || 'unknown')}`;
      log(`[${opId}] Publish failed — code=${errCode} subcode=${errSubcode} type=${errType} msg=${errMsg}`, 'threads-service');
      log(`[${opId}] Full error response: ${JSON.stringify(err.response?.data)}`, 'threads-service');

      // Если IMAGE/VIDEO не удалось (Meta не достучалась до медиа) — пробуем TEXT
      if (mediaType !== 'TEXT' && content.text) {
        log(`[${opId}] Retrying as TEXT (no media)`, 'threads-service');
        try {
          const cleanText = this.sanitizeThreadsText(content.text);
          const textContainerRes = await axios.post(
            `${THREADS_API}/${settings.threadsUserId}/threads`,
            null,
            { params: { media_type: 'TEXT', text: cleanText, access_token: accessToken } }
          );
          const textCreationId = textContainerRes.data.id;
          if (!textCreationId) throw new Error('Нет ID контейнера');
          await new Promise(r => setTimeout(r, 3000));
          const textPublishRes = await axios.post(
            `${THREADS_API}/${settings.threadsUserId}/threads_publish`,
            null,
            { params: { creation_id: textCreationId, access_token: accessToken } }
          );
          const textPostId = textPublishRes.data.id;
          const postUrl = `https://www.threads.net/@${settings.username || settings.threadsUserId}/post/${textPostId}`;
          log(`[${opId}] TEXT fallback successful: ${postUrl}`, 'threads-service');
          return { success: true, postId: textPostId, postUrl, warning: 'Опубликовано без изображения (медиа недоступно для Threads)' };
        } catch (fallbackErr: any) {
          log(`[${opId}] TEXT fallback also failed: ${fallbackErr.message}`, 'threads-service');
        }
      }

      return { success: false, error: errMsg };
    }
  }

  /**
   * Удаляет пост в Threads
   */
  async deletePost(postId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await axios.delete(`${THREADS_API}/${postId}`, {
        params: { access_token: accessToken }
      });
      return res.data?.success === true;
    } catch {
      return false;
    }
  }
}

export const threadsService = new ThreadsService();
