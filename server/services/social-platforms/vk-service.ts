/**
 * VK Direct Publishing Service
 * Публикует текст и изображения через VK API без N8N
 */

import axios from 'axios';
import FormData from 'form-data';
import log from '../../utils/logger';
import { formatVkErrorMessage, createVkApiError, isVkEnrichedError } from '../../utils/vk-error';

export const VK_DEFAULT_APP_ID = '6121396';

export interface VkSettings {
  token: string;
  groupId?: string;
  groupName?: string;
  // Для авто-обновления токена (VK ID OAuth2 v2)
  refreshToken?: string;
  clientId?: string;
  deviceId?: string;
  campaignId?: string;
  tokenExpiresAt?: string;
  tokenRefreshedAt?: string;
  [key: string]: any;
}

export interface VkPublishResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
}

class VkService {
  private readonly apiBase = 'https://api.vk.com/method';
  private readonly apiVersion = '5.199';

  private normalizeImageUrls(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(item => this.normalizeImageUrls(item));
    if (typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return this.normalizeImageUrls(item.url || item.imageUrl || item.image_url);
    }
    if (typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return this.normalizeImageUrls(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return [trimmed];
  }

  private resolveImageUrl(imageUrl: string): string {
    if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
    if (imageUrl.startsWith('//')) return `https:${imageUrl}`;

    const directusUrl = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');
    if (directusUrl && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageUrl)) {
      return `${directusUrl}/assets/${imageUrl}`;
    }

    const appUrl = (
      process.env.APP_URL ||
      process.env.PUBLIC_URL ||
      process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      ''
    ).replace(/\/$/, '');
    if (!appUrl) {
      throw new Error(`Относительный URL изображения нельзя разрешить без APP_URL/PUBLIC_URL: ${imageUrl}`);
    }
    return `${appUrl}/${imageUrl.replace(/^\//, '')}`;
  }

  /**
   * Зачищает HTML в plain-текст для VK (VK поддерживает только обычный текст)
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
      .replace(/<[^>]+>/g, '')
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
   * Автоматически определяет groupId через VK API.
   * Вызывает groups.get с filter=admin и возвращает ID первой группы.
   * Если групп нет — возвращает null (постим на личную стену).
   */
  async autoDetectGroupId(token: string, opId: string): Promise<string | null> {
    try {
      log.info(`[${opId}] [VK] groupId не задан — пытаемся определить автоматически`);
      const resp = await axios.get(`${this.apiBase}/groups.get`, {
        params: {
          filter: 'admin',
          fields: 'id,name',
          count: 10,
          access_token: token,
          v: this.apiVersion,
        },
        timeout: 10000,
      });

      if (resp.data?.error) {
        log.warn(`[${opId}] [VK] groups.get error: ${resp.data.error.error_msg}`);
        return null;
      }

      const items: Array<{ id: number; name?: string }> = resp.data?.response?.items || [];
      if (items.length === 0) {
        log.info(`[${opId}] [VK] Нет доступных групп с правами admin`);
        return null;
      }

      const groupId = String(items[0].id);
      log.info(`[${opId}] [VK] Авто-определён groupId: ${groupId} (${items[0].name || ''})`);
      return groupId;
    } catch (err: any) {
      log.warn(`[${opId}] [VK] Не удалось определить groupId: ${err.message}`);
      return null;
    }
  }

  /**
   * Загружает изображение на стену VK и возвращает attachment-строку (photo{owner_id}_{id})
   */
  private async uploadPhoto(imageUrl: string, token: string, groupId: string | undefined, opId: string): Promise<string> {
    try {
      const resolvedImageUrl = this.resolveImageUrl(imageUrl);
      log.info(`[${opId}] [VK] Загрузка фото: ${resolvedImageUrl.substring(0, 80)}`);

      const serverParams: Record<string, string> = {
        access_token: token,
        v: this.apiVersion
      };

      // Если есть groupId — загружаем в группу, иначе на личную стену
      if (groupId) {
        const cleanGroupId = String(groupId).replace(/^-/, '');
        serverParams.group_id = cleanGroupId;
      }

      const serverRes = await axios.post(`${this.apiBase}/photos.getWallUploadServer`, new URLSearchParams(serverParams), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (serverRes.data?.error) {
        throw createVkApiError('photos.getWallUploadServer', serverRes.data.error, serverRes.data, serverRes.status);
      }
      const uploadUrl: string = serverRes.data?.response?.upload_url;
      if (!uploadUrl) throw new Error('Не получен upload_url от VK');

      // Скачиваем картинку и заливаем на сервер VK
      const imgRes = await axios.get(resolvedImageUrl, { responseType: 'arraybuffer', timeout: 60000 });
      const imgBuffer = Buffer.from(imgRes.data);
      const contentType = (imgRes.headers['content-type'] as string) || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';

      const form = new FormData();
      form.append('photo', imgBuffer, { filename: `photo.${ext}`, contentType });

      const uploadRes = await axios.post(uploadUrl, form, {
        headers: form.getHeaders(), timeout: 120000
      });
      const uploadData = uploadRes.data;
      if (uploadData?.error) {
        throw new Error(`VK upload server: ${uploadData.error}`);
      }
      if (!uploadData?.photo || uploadData.server === undefined || !uploadData?.hash) {
        throw new Error('VK upload server returned incomplete data');
      }
      log.info(`[${opId}] [VK] Загружено: server=${uploadData.server}`);

      // Сохраняем фото
      const saveParams: Record<string, string> = {
        photo: uploadData.photo,
        server: String(uploadData.server),
        hash: uploadData.hash,
        access_token: token,
        v: this.apiVersion
      };
      if (groupId) {
        saveParams.group_id = String(groupId).replace(/^-/, '');
      }

      const saveRes = await axios.post(`${this.apiBase}/photos.saveWallPhoto`, new URLSearchParams(saveParams), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (saveRes.data?.error) {
        throw createVkApiError('photos.saveWallPhoto', saveRes.data.error, saveRes.data, saveRes.status);
      }
      const savedPhoto = saveRes.data?.response?.[0];
      if (!savedPhoto) throw new Error('Не удалось сохранить фото в VK');

      log.info(`[${opId}] [VK] Фото сохранено: photo${savedPhoto.owner_id}_${savedPhoto.id}`);
      return `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
    } catch (err: any) {
      // If error was already enriched with typed VK info, preserve the message as-is
      if (isVkEnrichedError(err)) {
        log.error(`[${opId}] [VK] Ошибка загрузки фото: ${err.message}`);
        throw err;
      }
      const data = err?.response?.data;
      const vkErr = data?.error;
      // Извлекаем читаемую причину: строка как есть, иначе error_msg/message/код.
      // Никогда не [object Object] и не raw JSON.
      let responseError: string | undefined;
      if (typeof vkErr === 'string' && vkErr) {
        responseError = vkErr;
      } else {
        responseError = vkErr?.error_msg || vkErr?.message
          || data?.error_msg
          || (typeof vkErr === 'object' && vkErr !== null ? `code ${vkErr.error_code ?? 'unknown'}` : undefined);
      }
      const reason = responseError ? `${err.message}: ${responseError}` : err.message;
      log.error(`[${opId}] [VK] Ошибка загрузки фото: ${reason}`);
      throw new Error(`Не удалось загрузить изображение в VK: ${reason}`);
    }
  }

  /**
   * Удаляет пост со стены группы VK
   */
  async deletePost(settings: VkSettings, postId: number): Promise<boolean> {
    try {
      const cleanGroupId = String(settings.groupId || '').replace(/^-/, '');
      const ownerId = cleanGroupId ? `-${cleanGroupId}` : undefined;
      const res = await axios.get(`${this.apiBase}/wall.delete`, {
        params: { owner_id: ownerId, post_id: postId, access_token: settings.token, v: this.apiVersion }
      });
      return res.data?.response === 1;
    } catch {
      return false;
    }
  }

  private async uploadVideo(videoUrl: string, token: string, groupId: string | undefined, opId: string): Promise<string | null> {
    try {
      log.info(`[${opId}] [VK] Загрузка видео: ${videoUrl.substring(0, 80)}`);

      const saveParams: Record<string, string> = {
        name: 'video',
        description: '',
        wallpost: '0',
        access_token: token,
        v: this.apiVersion
      };
      if (groupId) {
        saveParams.group_id = String(groupId).replace(/^-/, '');
      }

      const saveRes = await axios.post(`${this.apiBase}/video.save`, new URLSearchParams(saveParams), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const vkErr = saveRes.data?.error;
      if (vkErr) {
        const code = vkErr.error_code;
        if (code === 15) {
          throw new Error('VK токен не имеет прав на загрузку видео. Переподключите аккаунт с правами «Доступ к видеозаписям».');
        }
        throw new Error(`video.save Error: ${vkErr.error_msg}`);
      }

      const uploadUrl: string = saveRes.data?.response?.upload_url;
      const videoId: number = saveRes.data?.response?.video_id;
      const ownerId: number = saveRes.data?.response?.owner_id;
      if (!uploadUrl) throw new Error('VK не вернул upload_url для видео');

      // Скачиваем видео и загружаем на сервер VK
      log.info(`[${opId}] [VK] Скачиваем видео для загрузки...`);
      const vidRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000, maxContentLength: 500 * 1024 * 1024 });
      const vidBuffer = Buffer.from(vidRes.data);

      const form = new FormData();
      form.append('video_file', vidBuffer, { filename: 'video.mp4', contentType: 'video/mp4' });

      log.info(`[${opId}] [VK] Загружаем видео (${(vidBuffer.length / 1024 / 1024).toFixed(1)} MB) на VK...`);
      const uploadRes = await axios.post(uploadUrl, form, {
        headers: form.getHeaders(),
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // VK upload-сервер возвращает JSON — проверяем его.
      // Если не проверять, невалидный аттачмент молча теряется в wall.post → только текст.
      log.info(`[${opId}] [VK] Ответ upload-сервера: ${JSON.stringify(uploadRes.data)}`);
      if (uploadRes.data?.error) {
        throw new Error(`VK upload server error: ${uploadRes.data.error}`);
      }
      // Некоторые VK upload-серверы возвращают пустой объект при ошибке
      if (!uploadRes.data || (typeof uploadRes.data === 'object' && Object.keys(uploadRes.data).length === 0)) {
        throw new Error('VK upload server вернул пустой ответ — видео не принято');
      }

      const attachment = `video${ownerId}_${videoId}`;
      log.info(`[${opId}] [VK] Видео загружено: ${attachment}`);
      return attachment;
    } catch (err: any) {
      log.warn(`[${opId}] [VK] Ошибка загрузки видео: ${err.message} — публикуем без видео`);
      return null;
    }
  }

  /**
   * Внутренний метод: выполняет wall.post с указанным токеном.
   * Бросает ошибку на любой VK API error.
   */
  private async doWallPost(
    token: string,
    groupId: string | undefined,
    content: { text: string; imageUrl?: string; additionalImages?: unknown; videoUrl?: string },
    opId: string
  ): Promise<VkPublishResult> {
    const cleanText = this.sanitizeText(content.text);

    let ownerId: string | undefined;
    if (groupId) {
      const cleanGroupId = String(groupId).replace(/^-/, '');
      ownerId = `-${cleanGroupId}`;
    }

    const postData: Record<string, string> = {
      message: cleanText,
      from_group: groupId ? '1' : '0',
      access_token: token,
      v: this.apiVersion
    };
    if (ownerId) postData.owner_id = ownerId;

    if (content.videoUrl) {
      const attachment = await this.uploadVideo(content.videoUrl, token, groupId, opId);
      if (attachment) postData.attachments = attachment;
    } else {
      const imageUrls = Array.from(new Set([
        ...(content.imageUrl ? [content.imageUrl] : []),
        ...this.normalizeImageUrls(content.additionalImages)
      ].filter(Boolean))).slice(0, 10);

      if (imageUrls.length > 0) {
        const attachments: string[] = [];
        for (const imageUrl of imageUrls) {
          attachments.push(await this.uploadPhoto(imageUrl, token, groupId, opId));
        }
        postData.attachments = attachments.join(',');
      }
    }

    const bodyParams = new URLSearchParams(postData);
    const postRes = await axios.post(`${this.apiBase}/wall.post`, bodyParams, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (postRes.data?.error) {
      const e = postRes.data.error;
      throw Object.assign(
        new Error(`VK API error ${e.error_code}: ${e.error_msg}`),
        { vkErrorCode: e.error_code }
      );
    }

    const postId: number = postRes.data?.response?.post_id;
    if (!postId) throw new Error('VK не вернул post_id');

    const postUrl = ownerId
      ? `https://vk.com/wall${ownerId}_${postId}`
      : `https://vk.com/wall_${postId}`;

    return { success: true, postId, postUrl };
  }

  async publishPost(
    settings: VkSettings,
    content: { text: string; imageUrl?: string; additionalImages?: unknown; videoUrl?: string }
  ): Promise<VkPublishResult> {
    const opId = `vk_direct_${Date.now()}`;
    try {
      let { token } = settings;
      if (!token) throw new Error('VK не настроен: отсутствует token');

      // Аварийная проверка срока действия токена перед каждым запросом.
      // Если до истечения менее 15 минут — обновляем прямо сейчас, не дожидаясь кроп.
      // Кроп ловит токены за 30-60 мин (бежит каждые 30 мин, порог 1ч) — это последний рубеж.
      if (settings.tokenExpiresAt && settings.refreshToken && settings.clientId && settings.campaignId) {
        const expiresAt = new Date(settings.tokenExpiresAt).getTime();
        const fifteenMinutes = 15 * 60 * 1000;
        if (Date.now() + fifteenMinutes >= expiresAt) {
          log.warn(`[${opId}] [VK] Токен истекает менее чем через 15 минут, обновляем заранее...`);
          try {
            const { refreshAndSaveVkToken } = await import('../vk-token-refresh');
            const newToken = await refreshAndSaveVkToken(
              settings.campaignId,
              { refreshToken: settings.refreshToken, clientId: settings.clientId, deviceId: settings.deviceId }
            );
            if (newToken) {
              token = newToken;
              log.info(`[${opId}] [VK] Токен обновлён проактивно`);
            }
          } catch (proactiveErr: any) {
            log.warn(`[${opId}] [VK] Проактивный refresh не удался: ${proactiveErr.message}, продолжаем со старым токеном`);
          }
        }
      }

      let groupId = settings.groupId;
      if (!groupId) {
        log.warn(`[${opId}] [VK] groupId не задан — пробуем авто-определение`);
        const autoId = await this.autoDetectGroupId(token, opId);
        if (autoId) {
          groupId = autoId;
          log.info(`[${opId}] [VK] Авто-группа: ${groupId}`);
        } else {
          log.warn(`[${opId}] [VK] Группы не найдены — публикуем на личную стену`);
        }
      }

      log.info(`[${opId}] [VK] Публикуем: group=${groupId || 'personal'}, image=${!!content.imageUrl}`);

      // Попытка 1
      try {
        const result = await this.doWallPost(token, groupId, content, opId);
        log.info(`[${opId}] [VK] Успешно: ${result.postUrl}`);
        return result;
      } catch (firstErr: any) {
        const code: number = firstErr.vkErrorCode;

        // Ошибка 10 — временная проблема сервера VK, ждём и повторяем до 3 раз
        if (code === 10) {
          log.warn(`[${opId}] [VK] Временная ошибка VK (10), повторяем...`);
          for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            try {
              const result = await this.doWallPost(token, groupId, content, opId);
              log.info(`[${opId}] [VK] Успешно с попытки ${attempt + 1}: ${result.postUrl}`);
              return result;
            } catch (retryErr: any) {
              if (retryErr.vkErrorCode !== 10 || attempt === 3) throw retryErr;
            }
          }
        }

        // Ошибка 5 — токен истёк.
        if (code === 5) {
          // Если есть refreshToken + clientId — пробуем авто-обновить
          if (settings.refreshToken && settings.clientId) {
            log.warn(`[${opId}] [VK] Токен истёк (ошибка 5), пробуем refresh...`);
            try {
              const { refreshAndSaveVkToken } = await import('../vk-token-refresh');
              const newToken = await refreshAndSaveVkToken(
                settings.campaignId || '',
                { refreshToken: settings.refreshToken, clientId: settings.clientId, deviceId: settings.deviceId }
              );
              if (newToken) {
                log.info(`[${opId}] [VK] Токен обновлён, повторяем публикацию`);
                const result = await this.doWallPost(newToken, groupId, content, opId);
                log.info(`[${opId}] [VK] Успешно после refresh: ${result.postUrl}`);
                return result;
              }
            } catch (refreshErr: any) {
              log.error(`[${opId}] [VK] Ошибка refresh: ${refreshErr.message}`);
            }
          }
          // Нет refresh token (needanapp) — токен протух, нужна повторная авторизация
          log.error(`[${opId}] [VK] Токен истёк (ошибка 5) без возможности авто-обновления`);
          return {
            success: false,
            error: 'TOKEN_EXPIRED',
            tokenExpired: true,
          } as any;
        }

        throw firstErr;
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.error_msg || err.message;
      log.error(`[${opId}] [VK] Ошибка публикации: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}

export const vkService = new VkService();
