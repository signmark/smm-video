/**
 * Telegram Direct Publishing Service
 * Публикует текст и изображения через Telegram Bot API без N8N
 */

import axios from 'axios';
import FormData from 'form-data';
import log from '../../utils/logger';
import { markdownToTelegramHtml } from '../../utils/strip-markdown';

export interface TelegramSettings {
  token: string;
  chatId: string;
}

export interface TelegramPublishResult {
  success: boolean;
  messageId?: number;
  postUrl?: string;
  error?: string;
}

class TelegramService {
  private readonly apiBase = 'https://api.telegram.org';

  /**
   * Зачищает HTML до подмножества, которое поддерживает Telegram (parse_mode=HTML)
   */
  private sanitizeText(raw: string): string {
    // Конвертируем Markdown в HTML ПЕРВЫМ делом (до обработки HTML-тегов)
    const withHtml = markdownToTelegramHtml(raw);
    return withHtml
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gis, '<b>$1</b>')
      .replace(/<em[^>]*>(.*?)<\/em>/gis, '<i>$1</i>')
      .replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis, '<a href="$1">$2</a>')
      .replace(/<(?!\/?(b|i|u|s|code|pre|a)\b)[^>]+>/gi, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Проксирует изображение через Cloudinary (Telegram не достаёт до российского S3)
   */
  private async proxyImage(imageUrl: string, opId: string): Promise<string> {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

      log.info(`[${opId}] [Telegram] Cloudinary proxy: ${imageUrl.substring(0, 80)}`);
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
      const buffer = Buffer.from(imgRes.data);
      const contentType = (imgRes.headers['content-type'] as string) || 'image/jpeg';
      const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

      const form = new FormData();
      form.append('file', dataUri);
      form.append('upload_preset', uploadPreset);
      form.append('folder', 'telegram-images');

      const res = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        form,
        { headers: form.getHeaders(), timeout: 60000 }
      );
      if (res.data?.secure_url) {
        log.info(`[${opId}] [Telegram] Cloudinary URL: ${res.data.secure_url}`);
        return res.data.secure_url;
      }
    } catch (err: any) {
      log.warn(`[${opId}] [Telegram] Cloudinary failed: ${err.message} — используем оригинал`);
    }
    return imageUrl;
  }

  /**
   * Удаляет сообщение из канала/чата
   */
  async deletePost(settings: TelegramSettings, messageId: number): Promise<boolean> {
    try {
      const res = await axios.post(`${this.apiBase}/bot${settings.token}/deleteMessage`, {
        chat_id: settings.chatId,
        message_id: messageId
      });
      return res.data?.ok === true;
    } catch {
      return false;
    }
  }

  async publishPost(
    settings: TelegramSettings,
    content: { text: string; imageUrl?: string; videoUrl?: string }
  ): Promise<TelegramPublishResult> {
    const opId = `tg_direct_${Date.now()}`;
    try {
      const { token, chatId } = settings;
      if (!token || !chatId) throw new Error('Telegram не настроен: отсутствует token или chatId');

      const cleanText = this.sanitizeText(content.text);
      const apiUrl = `${this.apiBase}/bot${token}`;

      log.info(`[${opId}] [Telegram] Публикуем в ${chatId}, image=${!!content.imageUrl}, video=${!!content.videoUrl}`);

      let messageId: number;
      let res: any;

      if (content.videoUrl) {
        // Видео-пост: caption ≤ 1024 символов
        const captionFits = cleanText && cleanText.length <= 1024;
        const videoParams: Record<string, any> = {
          chat_id: chatId,
          video: content.videoUrl,
          supports_streaming: true,
          parse_mode: 'HTML'
        };
        if (captionFits) videoParams.caption = cleanText;

        const resp = await axios.post(`${apiUrl}/sendVideo`, videoParams);
        res = resp.data;
        messageId = res.result?.message_id;

        if (!res.ok) {
          throw new Error(res.description || 'Telegram API вернул ошибку при sendVideo');
        }

        if (cleanText && !captionFits) {
          const MAX = 4096;
          const text = cleanText.length <= MAX
            ? cleanText
            : cleanText.slice(0, cleanText.lastIndexOf(' ', MAX - 1)) + '…';
          const textResp = await axios.post(`${apiUrl}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_to_message_id: messageId,
            disable_web_page_preview: true
          });
          if (!textResp.data?.ok) {
            log.warn(`[${opId}] [Telegram] sendMessage с текстом (после видео) не прошёл: ${textResp.data?.description}`);
          }
        }
      } else if (content.imageUrl) {
        const proxiedUrl = await this.proxyImage(content.imageUrl, opId);

        // Telegram caption у фото жёстко ≤ 1024 символов.
        // Если текст длиннее — отправляем картинку без caption, текст следом отдельным сообщением.
        const captionFits = cleanText && cleanText.length <= 1024;

        const params: Record<string, any> = {
          chat_id: chatId,
          photo: proxiedUrl,
          parse_mode: 'HTML'
        };
        if (captionFits) params.caption = cleanText;

        const resp = await axios.post(`${apiUrl}/sendPhoto`, params);
        res = resp.data;
        messageId = res.result?.message_id;

        if (!res.ok) {
          throw new Error(res.description || 'Telegram API вернул ошибку при sendPhoto');
        }

        if (cleanText && !captionFits) {
          // sendMessage лимит 4096; если вдруг превышаем — режем по слову на границе.
          const MAX = 4096;
          const text = cleanText.length <= MAX
            ? cleanText
            : cleanText.slice(0, cleanText.lastIndexOf(' ', MAX - 1)) + '…';

          const textResp = await axios.post(`${apiUrl}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_to_message_id: messageId,
            disable_web_page_preview: true
          });
          if (!textResp.data?.ok) {
            log.warn(`[${opId}] [Telegram] sendMessage с текстом не прошёл: ${textResp.data?.description}`);
          } else {
            log.info(`[${opId}] [Telegram] Текст отправлен отдельным сообщением (${cleanText.length} chars)`);
          }
        }
      } else {
        const resp = await axios.post(`${apiUrl}/sendMessage`, {
          chat_id: chatId,
          text: cleanText,
          parse_mode: 'HTML'
        });
        res = resp.data;
        messageId = res.result?.message_id;
      }

      if (!res.ok) {
        throw new Error(res.description || 'Telegram API вернул ошибку');
      }

      const chatIdClean = String(chatId).replace('@', '');
      const postUrl = messageId
        ? `https://t.me/${chatIdClean}/${messageId}`
        : `https://t.me/${chatIdClean}`;

      log.info(`[${opId}] [Telegram] Успешно: messageId=${messageId}, url=${postUrl}`);
      return { success: true, messageId, postUrl };
    } catch (err: any) {
      const errMsg = err.response?.data?.description || err.message;
      log.error(`[${opId}] [Telegram] Ошибка: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}

export const telegramService = new TelegramService();
