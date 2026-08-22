/**
 * Instagram Direct Publishing Service
 * Публикует фото/текст через Instagram Graph API
 * Требует: accessToken (Meta user token), businessAccountId (IG Business Account ID)
 */

import axios from 'axios';
import { getOptionalServiceUrl } from '../../config/service-urls';
import { trackExternalCall } from '../../utils/external-call';
import FormData from 'form-data';
import { randomUUID } from 'crypto';
import log, { logEvent } from '../../utils/logger';
import { storeTempVideo } from '../../utils/temp-video-store';
import { describePlatformError } from './platform-error';

/**
 * Скачивает видео и возвращает публичный URL для Instagram API.
 * Meta-серверы не могут получить доступ к российским S3 хранилищам (beget.cloud и др.).
 * Приоритет: Cloudinary → локальный прокси → оригинал
 */
async function proxyVideoForInstagram(videoUrl: string, opId: string): Promise<string> {
  log.info(`[${opId}] [Instagram] Скачиваем видео для проксирования: ${videoUrl.substring(0, 80)}`);
  const resp = await trackExternalCall('instagram', 'container.status', () => axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 500 * 1024 * 1024
  }));
  const buffer = Buffer.from(resp.data);
  const contentType = (resp.headers['content-type'] as string) || 'video/mp4';
  log.info(`[${opId}] [Instagram] Видео скачано (${(buffer.length / 1024 / 1024).toFixed(1)} MB), загружаем в Cloudinary...`);

  // Пробуем Cloudinary — глобально доступен для Meta серверов
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';
    const base64 = buffer.toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;
    const form = new FormData();
    form.append('file', dataUri);
    form.append('upload_preset', uploadPreset);
    form.append('resource_type', 'video');
    form.append('folder', 'instagram-reels');
    const res = await trackExternalCall('instagram', 'media.create', () => axios.post(
      `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      form,
      { headers: form.getHeaders(), timeout: 180000, maxContentLength: 500 * 1024 * 1024, maxBodyLength: 500 * 1024 * 1024 }
    ));
    if (res.data?.secure_url) {
      log.info(`[${opId}] [Instagram] Видео загружено в Cloudinary: ${res.data.secure_url}`);
      return res.data.secure_url;
    }
  } catch (err: any) {
    log.warn(`[${opId}] [Instagram] Cloudinary upload failed: ${err.response?.data?.error?.message || err.message} — пробуем локальный прокси`);
  }

  // Fallback: локальный прокси через наш сервер
  const serverBaseUrl = getOptionalServiceUrl('APP_PUBLIC_URL') ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
    process.env.APP_URL;
  if (serverBaseUrl) {
    const id = randomUUID();
    storeTempVideo(id, buffer, contentType);
    const proxyUrl = `${serverBaseUrl}/api/video-temp/${id}`;
    log.info(`[${opId}] [Instagram] Используем локальный прокси: ${proxyUrl}`);
    return proxyUrl;
  }

  log.warn(`[${opId}] [Instagram] Нет доступного прокси, используем оригинальный URL (может не работать с Meta)`);
  return videoUrl;
}

export interface InstagramSettings {
  accessToken?: string;
  token?: string;
  businessAccountId: string;
}

export interface InstagramPublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

class InstagramService {
  private readonly apiVersion = 'v19.0';
  private readonly graphBase = 'https://graph.facebook.com';

  /**
   * Зачищает HTML → plain text для Instagram (не поддерживает разметку)
   */
  private sanitizeText(raw: string): string {
    let text = raw
      // --- HTML: блочные элементы → переносы строк ---
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // --- Убираем оставшиеся HTML-теги ---
      .replace(/<[^>]*>/g, '')
      // --- HTML-сущности ---
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      // --- Markdown: изображения (убираем полностью) ---
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // --- Markdown: ссылки [текст](url) → текст ---
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // --- Markdown: заголовки # / ## / ### → текст без # ---
      .replace(/^#{1,6}\s+/gm, '')
      // --- Markdown: жирный ***текст*** / **текст** / __текст__ ---
      .replace(/\*{3}([^*]+)\*{3}/g, '$1')
      .replace(/\*{2}([^*]+)\*{2}/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // --- Markdown: курсив *текст* / _текст_ ---
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1')
      // --- Markdown: зачёркнутый ~~текст~~ ---
      .replace(/~~([^~]+)~~/g, '$1')
      // --- Markdown: инлайн-код `код` ---
      .replace(/`([^`\n]+)`/g, '$1')
      // --- Markdown: блок кода ```...``` ---
      .replace(/```[\s\S]*?```/g, '')
      // --- Markdown: горизонтальная линия --- / *** / ___ ---
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // --- Markdown: цитаты > текст → текст ---
      .replace(/^>\s?/gm, '')
      // --- Markdown: маркированные списки - / * / + в начале строки ---
      .replace(/^[\-\*\+]\s+/gm, '')
      // --- Markdown: нумерованные списки 1. 2. и т.д. ---
      .replace(/^\d+\.\s+/gm, '')
      // --- Убираем более 2 переносов подряд ---
      .replace(/\n{3,}/g, '\n\n')
      // --- Убираем лишние пробелы в каждой строке ---
      .replace(/[^\S\n]+/g, ' ')
      .replace(/^ /gm, '')
      .trim();
    return text;
  }

  /**
   * Проксирует изображение через Cloudinary (Instagram Graph API не достаёт до российского S3)
   */
  private async proxyImage(imageUrl: string, opId: string): Promise<string> {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

      log.info(`[${opId}] [Instagram] Cloudinary proxy: ${imageUrl.substring(0, 80)}`);
      const imgRes = await trackExternalCall('instagram', 'permalink', () => axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 }));
      const buffer = Buffer.from(imgRes.data);
      const contentType = (imgRes.headers['content-type'] as string) || 'image/jpeg';
      const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

      const form = new FormData();
      form.append('file', dataUri);
      form.append('upload_preset', uploadPreset);
      form.append('folder', 'instagram-images');

      const res = await trackExternalCall('instagram', 'media.publish', () => axios.post(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        form,
        { headers: form.getHeaders(), timeout: 60000 }
      ));
      if (res.data?.secure_url) {
        log.info(`[${opId}] [Instagram] Cloudinary URL: ${res.data.secure_url}`);
        return res.data.secure_url;
      }
    } catch (err: any) {
      log.warn(`[${opId}] [Instagram] Cloudinary failed: ${err.message} — используем оригинал`);
    }
    return imageUrl;
  }

  /**
   * Ожидает готовности media container (статус FINISHED)
   */
  private async waitForContainer(containerId: string, token: string, opId: string): Promise<boolean> {
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await axios.get(`${this.graphBase}/${this.apiVersion}/${containerId}`, {
        params: { fields: 'status_code,status', access_token: token }
      });
      const status = res.data?.status_code;
      const statusDetail = res.data?.status;
      log.info(`[${opId}] [Instagram] Container ${containerId} status: ${status}${statusDetail ? ` (${statusDetail})` : ''} (attempt ${i + 1})`);
      if (status === 'FINISHED') return true;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Instagram container error: ${status}${statusDetail ? ` — ${statusDetail}` : ''}. Возможные причины: видео не соответствует требованиям Reels (формат MP4/H.264, длина 3-90с, разрешение мин. 540px, соотношение 9:16), или URL видео недоступен публично.`);
      }
    }
    throw new Error('Timeout: Instagram не обработал видео за 90 секунд. Попробуйте позже.');
  }

  /**
   * Публикует пост в Instagram Business Account
   * contentId + directusToken — опционально, для защиты от дублирования при параллельных запросах
   */
  async publishPost(
    settings: InstagramSettings,
    content: { text: string; imageUrl?: string; videoUrl?: string },
    contentId?: string,
    directusToken?: string
  ): Promise<InstagramPublishResult> {
    const opId = `ig_direct_${Date.now()}`;
    try {
      const token = settings.accessToken || settings.token;
      const { businessAccountId } = settings;

      if (!token || !businessAccountId) {
        throw new Error('Instagram не настроен: отсутствует accessToken или businessAccountId');
      }

      const cleanText = this.sanitizeText(content.text).substring(0, 2200);
      log.info(`[${opId}] [Instagram] Публикуем в account ${businessAccountId}, image=${!!content.imageUrl}, caption_len=${cleanText.length}`);

      const base = `${this.graphBase}/${this.apiVersion}/${businessAccountId}`;

      let containerId: string;

      if (content.videoUrl) {
        // Reels-пост (видео)
        // Проксируем видео через Cloudinary или локальный прокси —
        // Meta-серверы не могут скачать файл с российского S3 (beget.cloud)
        const proxiedVideoUrl = await proxyVideoForInstagram(content.videoUrl, opId);
        log.info(`[${opId}] [Instagram] Создаём Reels container, video_url=${proxiedVideoUrl}`);
        const containerRes = await axios.post(`${base}/media`, null, {
          params: {
            media_type: 'REELS',
            video_url: proxiedVideoUrl,
            caption: cleanText,
            share_to_feed: true,
            access_token: token
          }
        });
        if (containerRes.data?.error) throw new Error(containerRes.data.error.message);
        containerId = containerRes.data?.id;
        if (!containerId) throw new Error('Instagram не вернул container id для Reels');

        log.info(`[${opId}] [Instagram] Reels container создан: ${containerId}, ожидаем обработки...`);
        await this.waitForContainer(containerId, token, opId);
      } else if (content.imageUrl) {
        // Фото-пост
        const proxiedUrl = await this.proxyImage(content.imageUrl, opId);
        const containerRes = await axios.post(`${base}/media`, null, {
          params: {
            image_url: proxiedUrl,
            caption: cleanText,
            access_token: token
          }
        });
        if (containerRes.data?.error) throw new Error(containerRes.data.error.message);
        containerId = containerRes.data?.id;
        if (!containerId) throw new Error('Instagram не вернул container id');

        log.info(`[${opId}] [Instagram] Container создан: ${containerId}`);
        await this.waitForContainer(containerId, token, opId);
      } else {
        // Текстовый пост (только для Instagram через caption без медиа не работает — используем заглушку)
        throw new Error('Instagram требует изображение или видео для публикации поста');
      }

      // Защита от дублирования: перед media_publish проверяем, не опубликовал ли параллельный запрос
      if (contentId && directusToken) {
        try {
          const directusUrl = process.env.DIRECTUS_URL;
          const checkResp = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
            headers: { Authorization: `Bearer ${directusToken}` }
          });
          const igStatus = checkResp.data?.data?.social_platforms?.instagram;
          if (igStatus?.status === 'published' && igStatus?.postUrl) {
            log.warn(`[${opId}] [Instagram] Уже опубликовано параллельным запросом (postUrl=${igStatus.postUrl}), отменяем media_publish`);
            return { success: true, postId: igStatus.postId, postUrl: igStatus.postUrl };
          }
        } catch (e: any) {
          // AI-65. Это единственная защита от повторной публикации. Если проверку
          // не удалось довести до ответа, публикация всё равно пойдёт — иначе
          // человек потеряет пост из-за недоступного Directus. Но пойдёт вслепую,
          // и на выходе может получиться два одинаковых поста у живой аудитории.
          // Молча такое обнаруживалось только в комментариях подписчиков.
          logEvent(
            'publish.duplicate_check_failed',
            { contentId, platform: 'instagram', reason: e?.message ? String(e.message) : 'unknown' },
            'warn',
            'instagram',
            'Проверка на повторную публикацию не удалась — публикуем вслепую',
          );
        }
      }

      // Публикуем container
      const publishRes = await axios.post(`${base}/media_publish`, null, {
        params: { creation_id: containerId, access_token: token }
      });
      if (publishRes.data?.error) throw new Error(publishRes.data.error.message);

      const postId: string = publishRes.data?.id;
      if (!postId) throw new Error('Instagram не вернул post id');

      // Получаем permalink
      let postUrl = `https://www.instagram.com/p/${postId}/`;
      try {
        const permalinkRes = await axios.get(`${this.graphBase}/${this.apiVersion}/${postId}`, {
          params: { fields: 'permalink', access_token: token }
        });
        if (permalinkRes.data?.permalink) postUrl = permalinkRes.data.permalink;
      } catch (e: any) {
        // AI-65. Пост опубликован, это главное. Не удалось получить постоянную
        // ссылку — человеку показывается собранная из postId, и она может не
        // открыться. Уровень отладки: не поломка, но объяснение жалобы
        // «ссылка на мой пост не работает».
        logEvent(
          'publish.permalink_unresolved',
          { contentId, platform: 'instagram', reason: e?.message ? String(e.message) : 'unknown' },
          'debug',
          'instagram',
          'Пост опубликован, но постоянную ссылку получить не удалось',
        );
      }

      log.info(`[${opId}] [Instagram] Успешно: postId=${postId}, url=${postUrl}`);
      return { success: true, postId, postUrl };
    } catch (err: any) {
      // SM-39: пустая строка тут оставляла и человека, и журнал без причины.
      const errMsg = describePlatformError(err, {
        platform: 'Instagram',
        step: 'публикация',
        opId,
      });
      log.error(`[${opId}] [Instagram] Ошибка: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Удаляет медиа-публикацию Instagram
   * Примечание: Meta Graph API поддерживает удаление только в некоторых случаях
   */
  async deletePost(postId: string, token: string): Promise<boolean> {
    try {
      const res = await trackExternalCall('instagram', 'media.delete', () => axios.delete(`${this.graphBase}/${this.apiVersion}/${postId}`, {
        params: { access_token: token }
      }));
      return res.data?.success === true;
    } catch {
      return false;
    }
  }
}

export const instagramService = new InstagramService();
