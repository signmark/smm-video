/**
 * Telegram Direct Publishing Service
 * Публикует текст и изображения через Telegram Bot API без N8N
 */

import axios from 'axios';
import FormData from 'form-data';
import log from '../../utils/logger';
import { toTelegramHtml } from '../../utils/telegram-html';
import { telegramAxios } from './telegram-http';

export interface TelegramSettings {
  token: string;
  chatId: string;
}

interface TelegramPostContent {
  text: string;
  imageUrl?: string;
  additionalImages?: unknown;
  videoUrl?: string;
}

/**
 * AI-102: собирает читаемый текст ошибки из всего, что дал транспорт.
 *
 * Породивший случай: публикация во все Telegram-каналы встала, а в логах и в
 * карточке контента было пустое «Ошибка Telegram API». Диагностика ушла в права
 * ботов и стоила нескольких часов, тогда как настоящей причиной был отказ
 * TCP/443 к одному из адресов api.telegram.org.
 *
 * Почему одного `err.message` мало: у сетевых отказов Node весь смысл лежит
 * рядом с сообщением (`code`, `syscall`, `address`, `port`), у ошибок API — в
 * `response.data.description`, а у AggregateError (несколько адресов подряд)
 * `message` бывает пустым, и всё содержательное лежит в `errors[]`.
 *
 * Функция обязана вернуть непустую строку всегда: пустая строка тут — это и
 * есть тот самый дефект.
 */
export function describeTelegramError(err: any): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
    if (s && !parts.includes(s)) parts.push(s);
  };

  push(err?.response?.data?.description);
  const status = err?.response?.status;
  if (status) push(`HTTP ${status}`);

  const cause = err?.cause || {};
  const code = err?.code || cause.code;
  push(code);

  const syscall = err?.syscall || cause.syscall;
  const address = err?.address || cause.address;
  const port = err?.port ?? cause.port;
  if (syscall || address) {
    push([syscall, address ? (port ? `${address}:${port}` : address) : ''].filter(Boolean).join(' '));
  }

  push(err?.message);
  push(cause.message);

  // AggregateError: перебор нескольких адресов — сообщение снаружи часто пустое.
  const inner = Array.isArray(err?.errors) ? err.errors : [];
  for (const e of inner) push(e?.message || e?.code);

  return parts.join(' | ') || 'Telegram: ошибка без текста (тип: ' + (err?.constructor?.name || typeof err) + ')';
}

export interface TelegramPublishResult {
  success: boolean;
  messageId?: number;
  postUrl?: string;
  error?: string;
}

class TelegramService {
  private readonly apiBase = 'https://api.telegram.org';

  private normalizeAdditionalImages(value: unknown): string[] {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.flatMap(item => this.normalizeAdditionalImages(item));
    }

    if (typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return this.normalizeAdditionalImages(item.url || item.imageUrl || item.image_url);
    }

    if (typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return this.normalizeAdditionalImages(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }

    return [trimmed];
  }

  /**
   * Зачищает HTML до подмножества, которое поддерживает Telegram (parse_mode=HTML).
   * Неподдерживаемые теги переформатируются в визуально похожий вид
   * (абзацы → переносы строк, списки → «• »/«1. », заголовки → <b>).
   */
  private sanitizeText(raw: string): string {
    return toTelegramHtml(raw);
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
    content: TelegramPostContent
  ): Promise<TelegramPublishResult> {
    const opId = `tg_direct_${Date.now()}`;
    try {
      const { token, chatId } = settings;
      if (!token || !chatId) throw new Error('Telegram не настроен: отсутствует token или chatId');

      const cleanText = this.sanitizeText(content.text);
      const imageUrls = Array.from(new Set([
        ...(content.imageUrl ? [content.imageUrl] : []),
        ...this.normalizeAdditionalImages(content.additionalImages),
      ]));

      log.info(`[${opId}] [Telegram] Публикуем в ${chatId}, images=${imageUrls.length}, video=${!!content.videoUrl}`);

      // AI-101: telegramAxios has DNS A-record failover
      const tg = await telegramAxios(token);

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

        const resp = await tg.post(`/sendVideo`, videoParams);
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
          const textResp = await tg.post(`/sendMessage`, {
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
      } else if (imageUrls.length > 1) {
        const proxiedUrls = await Promise.all(imageUrls.map(url => this.proxyImage(url, opId)));
        const captionFits = !!cleanText && cleanText.length <= 1024;
        const chunks: string[][] = [];
        for (let index = 0; index < proxiedUrls.length;) {
          const remaining = proxiedUrls.length - index;
          // Telegram accepts 2–10 items per media group. Avoid a final
          // one-item group for totals such as 11 or 21 images.
          const chunkSize = remaining === 11 ? 9 : Math.min(10, remaining);
          chunks.push(proxiedUrls.slice(index, index + chunkSize));
          index += chunkSize;
        }

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const media = chunks[chunkIndex].map((url, imageIndex) => ({
            type: 'photo',
            media: url,
            ...(chunkIndex === 0 && imageIndex === 0 && captionFits
              ? { caption: cleanText, parse_mode: 'HTML' }
              : {}),
          }));
          const resp = await tg.post(`/sendMediaGroup`, {
            chat_id: chatId,
            media,
          });
          res = resp.data;

          if (!res.ok) {
            throw new Error(res.description || 'Telegram API вернул ошибку при sendMediaGroup');
          }

          if (chunkIndex === 0) {
            messageId = res.result?.[0]?.message_id;
          }
        }

        if (cleanText && !captionFits) {
          const MAX = 4096;
          const boundary = cleanText.lastIndexOf(' ', MAX - 1);
          const text = cleanText.length <= MAX
            ? cleanText
            : cleanText.slice(0, boundary > 0 ? boundary : MAX - 1) + '…';
          const textResp = await tg.post(`/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_to_message_id: messageId,
            disable_web_page_preview: true,
          });
          if (!textResp.data?.ok) {
            log.warn(`[${opId}] [Telegram] sendMessage с текстом после медиагруппы не прошёл: ${textResp.data?.description}`);
          }
        }
      } else if (imageUrls.length === 1) {
        const proxiedUrl = await this.proxyImage(imageUrls[0], opId);

        // Telegram caption у фото жёстко ≤ 1024 символов.
        // Если текст длиннее — отправляем картинку без caption, текст следом отдельным сообщением.
        const captionFits = cleanText && cleanText.length <= 1024;

        const params: Record<string, any> = {
          chat_id: chatId,
          photo: proxiedUrl,
          parse_mode: 'HTML'
        };
        if (captionFits) params.caption = cleanText;

        const resp = await tg.post(`/sendPhoto`, params);
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

          const textResp = await tg.post(`/sendMessage`, {
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
        const resp = await tg.post(`/sendMessage`, {
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
      const errMsg = describeTelegramError(err);
      log.error(`[${opId}] [Telegram] Ошибка: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}

export const telegramService = new TelegramService();
