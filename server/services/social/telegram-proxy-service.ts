/**
 * Улучшенный сервис для публикации в Telegram с проксированием медиафайлов
 * Решает проблему доступа к файлам в Beget S3 из Telegram API
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { log } from '../../utils/logger';
import { mediaProxyService } from '../media-proxy-service';
import { CampaignContent, SocialMediaSettings, SocialPlatform, SocialPublication } from '../../../shared/types';

/**
 * Сервис для проксированной отправки содержимого в Telegram
 */
export class TelegramProxyService {
  /**
   * Отправляет видео в Telegram с проксированием через локальный сервер
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @param videoUrl URL видео в Beget S3
   * @param caption Подпись к видео
   * @returns Результат отправки
   */
  async sendProxiedVideoToTelegram(
    chatId: string,
    token: string,
    videoUrl: string,
    caption: string
  ): Promise<{ success: boolean; error?: string; messageId?: number; messageUrl?: string }> {
    log(`Отправка проксированного видео в Telegram: ${videoUrl}`, 'telegram-proxy');
    
    return await mediaProxyService.proxyMedia(videoUrl, async (localFilePath) => {
      try {
        // Формируем FormData для multipart/form-data запроса
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
        
        // Добавляем видеофайл с диска
        formData.append('video', fs.createReadStream(localFilePath));
        
        // Отправляем запрос
        const baseUrl = `https://api.telegram.org/bot${token}`;
        const response = await axios.post(`${baseUrl}/sendVideo`, formData, {
          headers: {
            ...formData.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000, // 60 секунд таймаут
        });
        
        log(`Ответ от Telegram API: ${JSON.stringify(response.data)}`, 'telegram-proxy');
        
        if (response.data.ok) {
          const messageId = response.data.result.message_id;
          
          return {
            success: true,
            messageId,
            messageUrl: this.formatTelegramUrl(chatId, chatId, messageId)
          };
        } else {
          return {
            success: false,
            error: `Ошибка API Telegram: ${response.data.description}`
          };
        }
      } catch (error: any) {
        log(`Ошибка при отправке видео в Telegram: ${error.message}`, 'telegram-proxy');
        
        // Расширенный лог для отладки
        if (error.response) {
          log(`Данные ответа: ${JSON.stringify(error.response.data)}`, 'telegram-proxy');
        }
        
        return {
          success: false,
          error: error.message
        };
      }
    });
  }
  
  /**
   * Отправляет изображения в Telegram с проксированием
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @param images Массив URL изображений
   * @param caption Подпись к изображениям
   * @returns Результат отправки
   */
  async sendProxiedImagesToTelegram(
    chatId: string,
    token: string,
    images: string[],
    caption?: string
  ): Promise<{ success: boolean; error?: string; messageIds?: number[]; messageUrl?: string }> {
    if (!images || images.length === 0) {
      return { success: true, messageIds: [] };
    }
    
    log(`Отправка ${images.length} проксированных изображений в Telegram`, 'telegram-proxy');
    
    if (images.length === 1) {
      // Отправка одного изображения
      return await mediaProxyService.proxyMedia(images[0], async (localFilePath) => {
        try {
          const formData = new FormData();
          formData.append('chat_id', chatId);
          if (caption) {
            formData.append('caption', caption);
            formData.append('parse_mode', 'HTML');
          }
          formData.append('photo', fs.createReadStream(localFilePath));
          
          const baseUrl = `https://api.telegram.org/bot${token}`;
          const response = await axios.post(`${baseUrl}/sendPhoto`, formData, {
            headers: formData.getHeaders(),
            timeout: 30000
          });
          
          if (response.data.ok) {
            const messageId = response.data.result.message_id;
            return {
              success: true,
              messageIds: [messageId],
              messageUrl: this.formatTelegramUrl(chatId, chatId, messageId)
            };
          } else {
            return {
              success: false,
              error: `Ошибка API Telegram: ${response.data.description}`
            };
          }
        } catch (error: any) {
          log(`Ошибка при отправке изображения в Telegram: ${error.message}`, 'telegram-proxy');
          return {
            success: false,
            error: error.message
          };
        }
      });
    } else {
      // Отправка группы изображений
      // Telegram API ограничивает группу до 10 изображений
      const chunk = images.slice(0, 10);
      
      try {
        // Загружаем все изображения на сервер
        const mediaPromises = chunk.map((imgUrl, index) => 
          mediaProxyService.proxyMedia(imgUrl, async (localPath) => ({ url: imgUrl, localPath, index }))
        );
        
        const mediaFiles = await Promise.all(mediaPromises);
        
        // Создаем медиагруппу
        const media = mediaFiles.map((file, index) => {
          const mediaItem: any = {
            type: 'photo',
            media: `attach://photo${file.index}`
          };
          
          // Подпись только к первому изображению
          if (index === 0 && caption) {
            mediaItem.caption = caption;
            mediaItem.parse_mode = 'HTML';
          }
          
          return mediaItem;
        });
        
        // Создаем FormData с приложениями
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('media', JSON.stringify(media));
        
        // Добавляем все файлы
        mediaFiles.forEach(file => {
          formData.append(`photo${file.index}`, fs.createReadStream(file.localPath));
        });
        
        // Отправляем запрос
        const baseUrl = `https://api.telegram.org/bot${token}`;
        const response = await axios.post(`${baseUrl}/sendMediaGroup`, formData, {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000
        });
        
        // Очищаем все временные файлы
        mediaFiles.forEach(file => {
          try {
            if (fs.existsSync(file.localPath)) {
              fs.unlinkSync(file.localPath);
            }
          } catch (error) {
            // Игнорируем ошибки удаления
          }
        });
        
        if (response.data.ok) {
          const messageIds = response.data.result.map((item: any) => item.message_id);
          return {
            success: true,
            messageIds,
            messageUrl: messageIds.length > 0 
              ? this.formatTelegramUrl(chatId, chatId, messageIds[0]) 
              : undefined
          };
        } else {
          return {
            success: false,
            error: `Ошибка API Telegram: ${response.data.description}`
          };
        }
      } catch (error: any) {
        log(`Ошибка при отправке группы изображений в Telegram: ${error.message}`, 'telegram-proxy');
        return {
          success: false,
          error: error.message
        };
      }
    }
  }
  
  /**
   * Форматирует URL для Telegram сообщения
   * @param chatId Оригинальный ID чата
   * @param formattedChatId Форматированный ID чата для API
   * @param messageId ID сообщения
   * @returns Форматированный URL
   */
  private formatTelegramUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
    if (!messageId) {
      throw new Error('MessageId обязателен для формирования URL Telegram');
    }
    
    // Определяем базовый URL
    let baseUrl = '';
    
    // Если это username (начинается с @), удаляем @ и не добавляем /c/
    if (chatId.startsWith('@')) {
      const username = chatId.substring(1);
      baseUrl = `https://t.me/${username}`;
    }
    // Для числовых ID проверяем, нужен ли префикс /c/
    else {
      // Проверяем, является ли chatId полным числовым идентификатором супергруппы/канала (с -100...)
      const isFullNumericId = chatId.startsWith('-100');
      
      if (isFullNumericId) {
        // Для таких ID нужен формат с /c/ и без -100
        const channelId = chatId.substring(4); // Убираем префикс -100
        baseUrl = `https://t.me/c/${channelId}`;
      } else if (chatId.startsWith('-')) {
        // Для групп с минусом, но не начинающихся с -100
        const channelId = chatId.substring(1); // Убираем префикс -
        baseUrl = `https://t.me/c/${channelId}`;
      } else {
        // Для обычных числовых ID без префикса
        baseUrl = `https://t.me/${chatId}`;
      }
    }
    
    // Создаем полный URL с ID сообщения
    return `${baseUrl}/${messageId}`;
  }
  
  /**
   * Публикует контент в Telegram с проксированием медиафайлов
   * @param content Контент для публикации
   * @param telegramSettings Настройки Telegram API
   * @returns Результат публикации
   */
  async publishToTelegram(
    content: CampaignContent,
    telegramSettings?: SocialMediaSettings['telegram']
  ): Promise<SocialPublication> {
    log(`Запуск проксированной публикации в Telegram для контента: ${content.id}`, 'telegram-proxy');
    
    // Проверяем наличие настроек
    if (!telegramSettings || !telegramSettings.token || !telegramSettings.chatId) {
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Telegram (токен или ID чата)'
      };
    }
    
    // Получаем токен и chatId
    const token = telegramSettings.token;
    const chatId = telegramSettings.chatId;
    
    // Подготавливаем текст для Telegram
    let formattedText = content.content;
    
    // Определяем наличие медиафайлов
    const hasVideo = !!content.video;
    const hasImages = Array.isArray(content.additionalImages) && content.additionalImages.length > 0;
    
    try {
      // Публикация видео
      if (hasVideo) {
        log(`Отправка видео в Telegram: ${content.video}`, 'telegram-proxy');
        
        // Подготавливаем подпись для видео
        const videoCaption = `<b>${content.title}</b>\n\n${formattedText}`;
        
        // Отправляем видео через прокси
        const videoResult = await this.sendProxiedVideoToTelegram(
          chatId, 
          token, 
          content.video as string, 
          videoCaption
        );
        
        if (videoResult.success) {
          log(`Видео успешно отправлено в Telegram, message_id: ${videoResult.messageId}`, 'telegram-proxy');
          
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            mediaUrl: videoResult.messageUrl,
            postId: videoResult.messageId?.toString()
          };
        } else {
          log(`Ошибка отправки видео в Telegram: ${videoResult.error}`, 'telegram-proxy');
          
          // Если видео не отправилось, пробуем отправить как текст
          log(`Попытка отправки текста после неудачной отправки видео`, 'telegram-proxy');
          
          // Отправляем обычный текст без HTML-разметки для надежности
          const textOnlyResult = await this.sendTextMessageToTelegram(
            `${content.title}\n\n${content.content.replace(/<[^>]*>/g, '')}`,
            chatId,
            token
          );
          
          if (textOnlyResult.success) {
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              mediaUrl: textOnlyResult.messageUrl,
              postId: textOnlyResult.messageId?.toString()
            };
          } else {
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Не удалось отправить видео или текст: ${textOnlyResult.error}`
            };
          }
        }
      }
      // Публикация изображений
      else if (hasImages) {
        log(`Отправка ${content.additionalImages.length} изображений в Telegram`, 'telegram-proxy');
        
        // Подготавливаем подпись
        const imageCaption = `<b>${content.title}</b>\n\n${formattedText}`;
        
        // Отправляем изображения через прокси
        const imagesResult = await this.sendProxiedImagesToTelegram(
          chatId,
          token,
          content.additionalImages as string[],
          imageCaption
        );
        
        if (imagesResult.success) {
          const messageId = imagesResult.messageIds && imagesResult.messageIds.length > 0 
            ? imagesResult.messageIds[0]
            : undefined;
          
          log(`Изображения успешно отправлены в Telegram, message_id: ${messageId}`, 'telegram-proxy');
          
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            mediaUrl: imagesResult.messageUrl,
            postId: messageId?.toString()
          };
        } else {
          log(`Ошибка отправки изображений в Telegram: ${imagesResult.error}`, 'telegram-proxy');
          
          // Если изображения не отправились, пробуем отправить как текст
          const textOnlyResult = await this.sendTextMessageToTelegram(
            `${content.title}\n\n${content.content.replace(/<[^>]*>/g, '')}`,
            chatId,
            token
          );
          
          if (textOnlyResult.success) {
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              mediaUrl: textOnlyResult.messageUrl,
              postId: textOnlyResult.messageId?.toString()
            };
          } else {
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Не удалось отправить изображения или текст: ${textOnlyResult.error}`
            };
          }
        }
      }
      // Публикация только текста
      else {
        log(`Отправка только текста в Telegram`, 'telegram-proxy');
        
        // Отправляем текст
        const textResult = await this.sendTextMessageToTelegram(
          `<b>${content.title}</b>\n\n${formattedText}`,
          chatId,
          token
        );
        
        if (textResult.success) {
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            mediaUrl: textResult.messageUrl,
            postId: textResult.messageId?.toString()
          };
        } else {
          return {
            platform: 'telegram',
            status: 'failed',
            publishedAt: null,
            error: `Не удалось отправить текст: ${textResult.error}`
          };
        }
      }
    } catch (error: any) {
      log(`Исключение при публикации в Telegram: ${error.message}`, 'telegram-proxy');
      
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: `Исключение при публикации: ${error.message}`
      };
    }
  }
  
  /**
   * Отправляет текстовое сообщение в Telegram
   * @param text Текст сообщения
   * @param chatId ID чата
   * @param token Токен бота
   * @returns Результат отправки
   */
  private async sendTextMessageToTelegram(
    text: string,
    chatId: string,
    token: string
  ): Promise<{ success: boolean; error?: string; messageId?: number; messageUrl?: string }> {
    try {
      // Балансируем HTML-теги, если они есть
      let processedText = this.ensureBalancedHtmlTags(text);
      
      // Отправляем запрос с HTML-форматированием
      const baseUrl = `https://api.telegram.org/bot${token}`;
      const response = await axios.post(`${baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: processedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
      if (response.data.ok) {
        const messageId = response.data.result.message_id;
        return {
          success: true,
          messageId,
          messageUrl: this.formatTelegramUrl(chatId, chatId, messageId)
        };
      } else {
        // Если ошибка связана с HTML, пробуем без форматирования
        if (response.data.description && 
            (response.data.description.includes('can\'t parse entities') || 
             response.data.description.includes('can\'t find end tag'))) {
          
          // Отправляем текст без HTML
          const plainText = text.replace(/<[^>]*>/g, '');
          const plainResponse = await axios.post(`${baseUrl}/sendMessage`, {
            chat_id: chatId,
            text: plainText,
            disable_web_page_preview: true
          });
          
          if (plainResponse.data.ok) {
            const messageId = plainResponse.data.result.message_id;
            return {
              success: true,
              messageId,
              messageUrl: this.formatTelegramUrl(chatId, chatId, messageId)
            };
          } else {
            return {
              success: false,
              error: `Ошибка отправки текста без HTML: ${plainResponse.data.description}`
            };
          }
        }
        
        return {
          success: false,
          error: `Ошибка API Telegram: ${response.data.description}`
        };
      }
    } catch (error: any) {
      log(`Ошибка при отправке текста в Telegram: ${error.message}`, 'telegram-proxy');
      
      if (error.response) {
        log(`Данные ответа: ${JSON.stringify(error.response.data)}`, 'telegram-proxy');
        
        // Если ошибка в HTML, пробуем отправить без форматирования
        try {
          const plainText = text.replace(/<[^>]*>/g, '');
          const baseUrl = `https://api.telegram.org/bot${token}`;
          const plainResponse = await axios.post(`${baseUrl}/sendMessage`, {
            chat_id: chatId,
            text: plainText,
            disable_web_page_preview: true
          });
          
          if (plainResponse.data.ok) {
            const messageId = plainResponse.data.result.message_id;
            return {
              success: true,
              messageId,
              messageUrl: this.formatTelegramUrl(chatId, chatId, messageId)
            };
          }
        } catch (plainError) {
          // Если и тут ошибка, возвращаем оригинальную
        }
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Обеспечивает баланс HTML-тегов в тексте
   * @param text Исходный текст
   * @returns Текст с балансом тегов
   */
  private ensureBalancedHtmlTags(text: string): string {
    // Регулярное выражение для поиска открывающих и закрывающих тегов
    const openTagRegex = /<([a-z]+)[^>]*>/gi;
    const closeTagRegex = /<\/([a-z]+)>/gi;
    
    // Получаем все открывающие и закрывающие теги
    const openTagMatches = text.match(openTagRegex) || [];
    const closeTagMatches = text.match(closeTagRegex) || [];
    
    // Если количество открывающих и закрывающих тегов совпадает, возвращаем исходный текст
    if (openTagMatches.length === closeTagMatches.length) {
      return text;
    }
    
    // Извлекаем имена тегов
    const openTags = openTagMatches.map(tag => tag.replace(/<([a-z]+)[^>]*>/i, '$1').toLowerCase());
    const closeTags = closeTagMatches.map(tag => tag.replace(/<\/([a-z]+)>/i, '$1').toLowerCase());
    
    // Создаем стек для отслеживания незакрытых тегов
    const tagStack: string[] = [];
    let resultText = text;
    
    // Анализируем теги по порядку
    for (let i = 0; i < openTags.length; i++) {
      const tagName = openTags[i];
      const closeIndex = closeTags.indexOf(tagName);
      
      if (closeIndex !== -1) {
        // Тег закрыт - удаляем из списка закрытых
        closeTags.splice(closeIndex, 1);
      } else {
        // Тег не закрыт - добавляем в стек
        tagStack.push(tagName);
      }
    }
    
    // Если есть незакрытые теги, добавляем их закрытие в конец
    if (tagStack.length > 0) {
      for (let i = tagStack.length - 1; i >= 0; i--) {
        resultText += `</${tagStack[i]}>`;
      }
    }
    
    return resultText;
  }
}

export const telegramProxyService = new TelegramProxyService();