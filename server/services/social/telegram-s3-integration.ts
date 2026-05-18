/**
 * Интеграция Telegram с Beget S3 для работы с видео
 */
import axios from 'axios';
import FormData from 'form-data';
import { begetS3StorageAws } from '../beget-s3-storage-aws';
import { begetS3VideoService } from '../beget-s3-video-service';
import { log } from '../../utils/logger';

export interface TelegramVideoMessageOptions {
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  has_spoiler?: boolean;
  supports_streaming?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
}

// Для обратной совместимости добавляем интерфейс для параметризованного вызова
export interface TelegramVideoParams {
  videoUrl: string;
  chatId: string;
  token: string;
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  has_spoiler?: boolean;
  supports_streaming?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
}

export interface TelegramVideoResult {
  success: boolean;
  messageId?: number;
  error?: string;
  url?: string;
}

export class TelegramS3Integration {
  private logPrefix = 'telegram-s3';

  /**
   * Отправляет видео из Beget S3 в Telegram (перегрузка для объекта параметров)
   * @param params Объект с параметрами для отправки видео
   * @returns Результат отправки
   */
  async sendVideoToTelegram(params: TelegramVideoParams): Promise<TelegramVideoResult>;

  /**
   * Отправляет видео из Beget S3 в Telegram
   * @param videoUrl URL видео в Beget S3 или внешний URL
   * @param chatId ID чата в Telegram
   * @param token Токен бота Telegram
   * @param options Опции для отправки видео
   * @returns Результат отправки
   */
  async sendVideoToTelegram(
    videoUrlOrParams: string | TelegramVideoParams,
    chatId?: string,
    token?: string,
    options: TelegramVideoMessageOptions = {}
  ): Promise<TelegramVideoResult> {
    // Проверяем, какая перегрузка вызвана
    if (typeof videoUrlOrParams === 'object') {
      // Вызов с объектом параметров
      const params = videoUrlOrParams;
      return this.sendVideoToTelegramImpl(
        params.videoUrl,
        params.chatId,
        params.token,
        {
          caption: params.caption,
          parse_mode: params.parse_mode,
          has_spoiler: params.has_spoiler,
          supports_streaming: params.supports_streaming,
          disable_notification: params.disable_notification,
          protect_content: params.protect_content,
          reply_to_message_id: params.reply_to_message_id,
          allow_sending_without_reply: params.allow_sending_without_reply
        }
      );
    } else {
      // Вызов с индивидуальными параметрами
      if (!chatId || !token) {
        return {
          success: false,
          error: 'Missing required parameters (chatId or token)'
        };
      }
      return this.sendVideoToTelegramImpl(videoUrlOrParams, chatId, token, options);
    }
  }

  /**
   * Внутренняя реализация отправки видео в Telegram
   * @private
   */
  private async sendVideoToTelegramImpl(
    videoUrl: string,
    chatId: string,
    token: string,
    options: TelegramVideoMessageOptions = {}
  ): Promise<TelegramVideoResult> {
    try {
      log.info(`Sending video to Telegram: ${videoUrl}`, this.logPrefix);
      
      // Форматируем chat ID для API запросов
      const formattedChatId = this.formatChatId(chatId);
      log.info(`Formatted chat ID: ${formattedChatId}`, this.logPrefix);
      
      // Проверяем, нужно ли предварительно загрузить видео в S3
      let finalVideoUrl = videoUrl;
      let isS3Video = false;
      
      // Если это не URL в домене Beget S3, загружаем видео в S3
      if (!this.isBegetS3Url(videoUrl)) {
        log.info(`Video is not from Beget S3, uploading to S3 first: ${videoUrl}`, this.logPrefix);
        
        const uploadResult = await begetS3VideoService.uploadVideoFromUrl(videoUrl);
        
        if (!uploadResult.success || !uploadResult.videoUrl) {
          throw new Error(`Failed to upload video to S3: ${uploadResult.error}`);
        }
        
        finalVideoUrl = uploadResult.videoUrl;
        isS3Video = true;
        log.info(`Video uploaded to S3: ${finalVideoUrl}`, this.logPrefix);
      } else {
        isS3Video = true;
      }

      // Отправляем видео через Telegram API
      const apiUrl = `https://api.telegram.org/bot${token}/sendVideo`;
      const formData = new FormData();
      
      formData.append('chat_id', formattedChatId);
      
      // Если это S3 видео, отправляем через URL
      if (isS3Video) {
        formData.append('video', finalVideoUrl);
      } else {
        // Если это внешнее видео, скачиваем его и отправляем
        log.info(`Downloading video for direct upload: ${finalVideoUrl}`, this.logPrefix);
        const videoBuffer = await this.downloadFile(finalVideoUrl);
        formData.append('video', videoBuffer, { filename: 'video.mp4' });
      }
      
      // Добавляем опции
      if (options.caption) formData.append('caption', options.caption);
      if (options.parse_mode) formData.append('parse_mode', options.parse_mode);
      if (options.has_spoiler) formData.append('has_spoiler', options.has_spoiler.toString());
      if (options.supports_streaming) formData.append('supports_streaming', options.supports_streaming.toString());
      if (options.disable_notification) formData.append('disable_notification', options.disable_notification.toString());
      if (options.protect_content) formData.append('protect_content', options.protect_content.toString());
      if (options.reply_to_message_id) formData.append('reply_to_message_id', options.reply_to_message_id.toString());
      if (options.allow_sending_without_reply) formData.append('allow_sending_without_reply', options.allow_sending_without_reply.toString());
      
      log.info(`Sending request to Telegram API: ${apiUrl}`, this.logPrefix);
      
      const response = await axios.post(apiUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 60000 // 60 секунд таймаут для больших видео
      });
      
      if (!response.data.ok) {
        throw new Error(`Telegram API error: ${JSON.stringify(response.data)}`);
      }
      
      const messageId = response.data.result.message_id;
      log.info(`Video sent successfully, message ID: ${messageId}`, this.logPrefix);
      
      // Форматируем URL для доступа к сообщению
      const messageUrl = this.formatTelegramUrl(chatId, formattedChatId, messageId);
      
      return {
        success: true,
        messageId,
        url: messageUrl
      };
    } catch (error) {
      log.error(`Error sending video to Telegram: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Форматирует chat ID для API запросов Telegram
   * @param chatId ID чата (может быть username или числовой ID)
   * @returns Форматированный chat ID
   */
  private formatChatId(chatId: string): string {
    // Если chatId начинается с '@', значит это username
    if (chatId.startsWith('@')) {
      return chatId;
    }
    
    // Если это числовой ID, оставляем как есть
    return chatId;
  }

  /**
   * Форматирует URL на сообщение в Telegram
   * @param chatId Исходный chat ID (может быть @username или числовым ID)
   * @param formattedChatId Форматированный chat ID для API запросов
   * @param messageId ID сообщения
   * @returns URL на сообщение
   */
  private formatTelegramUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
    if (!messageId) {
      throw new Error('Message ID is required to format Telegram URL');
    }
    
    // Если это username (начинается с @)
    if (chatId.startsWith('@')) {
      const username = chatId.substring(1); // Убираем символ @
      return `https://t.me/${username}/${messageId}`;
    }
    
    // Если это публичный канал с числовым ID, начинающимся с -100
    if (chatId.startsWith('-100')) {
      const channelId = chatId.substring(4); // Удаляем префикс -100
      return `https://t.me/c/${channelId}/${messageId}`;
    }
    
    // Если это группа с числовым ID, начинающимся с -
    if (chatId.startsWith('-')) {
      const groupId = chatId.substring(1); // Удаляем минус
      return `https://t.me/c/${groupId}/${messageId}`;
    }
    
    // Если это личный чат или другой тип ID
    return `https://t.me/c/${chatId}/${messageId}`;
  }

  /**
   * Проверяет, является ли URL ссылкой на Beget S3
   * @param url URL для проверки
   * @returns true если URL указывает на Beget S3
   */
  private isBegetS3Url(url: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Проверяем, содержит ли домен beget
      return urlObj.hostname.includes('beget') && urlObj.hostname.includes('storage');
    } catch (error) {
      return false;
    }
  }

  /**
   * Скачивает файл по URL
   * @param url URL файла
   * @returns Buffer с содержимым файла
   */
  private async downloadFile(url: string): Promise<Buffer> {
    try {
      log.info(`Downloading file: ${url}`, this.logPrefix);
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000 // 60 секунд таймаут для больших файлов
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      log.error(`Error downloading file: ${(error as Error).message}`, this.logPrefix);
      throw error;
    }
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const telegramS3Integration = new TelegramS3Integration();