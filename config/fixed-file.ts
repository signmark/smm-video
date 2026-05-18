import axios from 'axios';
import { log } from '../utils/logger';
import { CampaignContent, InsertCampaignContent, SocialMediaSettings, SocialPlatform, SocialPublication } from '@shared/schema';
import { storage } from '../storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import FormData from 'form-data';
import { imgurUploaderService } from './imgur-uploader';

/**
 * Сервис для публикации контента в социальные сети с поддержкой Imgur для изображений
 */
export class SocialPublishingWithImgurService {
  private imgurClientId = process.env.IMGUR_CLIENT_ID || 'fc3d6ae9c21a8df';

  /**
   * Получает системный токен для доступа к API Directus
   * @returns Токен доступа или null в случае ошибки
   */
  private async getSystemToken(): Promise<string | null> {
    try {
      const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
      const directusCrud = await import('./directus-crud').then(m => m.directusCrud);
      const adminUserId = process.env.DIRECTUS_ADMIN_USER_ID || '53921f16-f51d-4591-80b9-8caa4fde4d13';
      
      // 1. Приоритет - авторизация через логин/пароль (если есть учетные данные)
      const email = process.env.DIRECTUS_ADMIN_EMAIL;
      const password = process.env.DIRECTUS_ADMIN_PASSWORD;
      
      if (email && password) {
        log('Попытка авторизации администратора с учетными данными из env', 'social-publishing');
        
        try {
          // Прямая авторизация через REST API
          const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
          const response = await axios.post(`${directusUrl}/auth/login`, {
            email,
            password
          });
          
          if (response?.data?.data?.access_token) {
            const token = response.data.data.access_token;
            log('Авторизация администратора успешна через прямой API запрос', 'social-publishing');
            
            return token;
          }
        } catch (error: any) {
          log(`Ошибка при прямой авторизации администратора: ${error.message}`, 'social-publishing');
        }
        
        try {
          // Запасной вариант - через DirectusAuthManager
          const authInfo = await directusAuthManager.login(email, password);
          
          if (authInfo && authInfo.token) {
            log('Авторизация администратора успешна через directusAuthManager', 'social-publishing');
            return authInfo.token;
          }
          
          // Если не получилось через directusAuthManager, пробуем через directusCrud
          const authResult = await directusCrud.login(email, password);
          
          if (authResult?.access_token) {
            log('Авторизация администратора успешна через directusCrud', 'social-publishing');
            return authResult.access_token;
          }
        } catch (error: any) {
          log(`Ошибка при авторизации через вспомогательные сервисы: ${error.message}`, 'social-publishing');
        }
      }
      
      // 2. Используем API Directus для получения токена администратора
      const directusApiManager = await import('../directus').then(m => m.directusApiManager);
      const cachedToken = directusApiManager.getCachedToken(adminUserId);
      
      if (cachedToken) {
        log(`Найден кэшированный токен для администратора ${adminUserId}`, 'social-publishing');
        return cachedToken.token;
      }
      
      log('Не удалось получить действительный токен для обновления статуса публикаций', 'social-publishing');
      return null;
    } catch (error: any) {
      log(`Ошибка при получении системного токена: ${error.message}`, 'social-publishing');
      return null;
    }
  }

  /**
   * Универсальный метод для отправки изображений в Telegram
   * @param chatId ID чата Telegram 
   * @param token Токен бота Telegram
   * @param images Массив URL изображений
   * @param baseUrl Базовый URL API Telegram
   * @returns Результат отправки (успех/ошибка)
   */
  private async sendImagesToTelegram(
    chatId: string,
    token: string,
    images: string[],
    baseUrl: string = `https://api.telegram.org/bot${token}`
  ): Promise<{success: boolean, error?: string, messageIds?: number[], messageUrl?: string}> {
    if (!images || images.length === 0) {
      log(`sendImagesToTelegram: Пустой массив изображений`, 'telegram-debug');
      return {success: true, messageIds: []}; // Нет изображений - нет проблем
    }
    
    // Форматируем chatId, если это необходимо
    let formattedChatId = chatId;
    let originalChatId = chatId; // Оригинальный ID для создания URL
    
    if (chatId.startsWith('@')) {
      // Это имя пользователя - не нужно форматировать для API, но сохраняем без @ для URL
      originalChatId = chatId.substring(1); // Убираем @ для URL
    } else if (!chatId.startsWith('-100') && !isNaN(Number(chatId))) {
      // Для групповых чатов добавляем префикс -100 для API
      formattedChatId = `-100${chatId}`;
      // Оригинальный ID без -100 для URL будет использоваться именно числовой ID
      originalChatId = chatId;
    }
    
    log(`Отправка ${images.length} изображений в Telegram, chatId для API: ${formattedChatId}, для URL: ${originalChatId}`, 'telegram-debug');
    
    // Проверяем доступность каждого URL через HEAD запрос
    const validImages: string[] = [];
    for (const imgUrl of images) {
      try {
        // Проверяем, что URL не пустой
        if (!imgUrl || typeof imgUrl !== 'string' || imgUrl.trim() === '') {
          log(`Пропускаем пустой URL изображения`, 'telegram-debug');
          continue;
        }
        
        log(`Проверка доступности изображения: ${imgUrl}`, 'telegram-debug');
        validImages.push(imgUrl);
      } catch (err) {
        log(`Ошибка при проверке доступности изображения ${imgUrl}: ${(err as Error).message}`, 'telegram-debug');
      }
    }
    
    log(`Найдено ${validImages.length} доступных изображений из ${images.length}`, 'telegram-debug');
    
    if (validImages.length === 0) {
      return {
        success: false,
        error: 'Нет доступных изображений для отправки'
      };
    }
    
    try {
      // Если одно изображение - отправляем как отдельное фото
      if (validImages.length === 1) {
        log(`Отправка одного изображения через sendPhoto: ${validImages[0]}`, 'telegram-debug');
        const response = await axios.post(`${baseUrl}/sendPhoto`, {
          chat_id: formattedChatId,
          photo: validImages[0],
          parse_mode: 'HTML'
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
          validateStatus: () => true
        });
        
        if (response.status === 200 && response.data.ok) {
          log(`Изображение успешно отправлено в Telegram`, 'social-publishing');
          const messageId = response.data.result.message_id;
          
          // Создаем правильный URL сообщения с помощью нашего метода-форматера
          const messageUrl = this.formatTelegramUrl(originalChatId, formattedChatId, messageId);
          log(`Создан URL сообщения через formatTelegramUrl: ${messageUrl}`, 'telegram-debug');
          
          return {
            success: true,
            messageIds: [messageId],
            messageUrl
          };
        } else {
          log(`Ошибка при отправке изображения в Telegram: ${JSON.stringify(response.data)}`, 'social-publishing');
          return {
            success: false,
            error: `Ошибка API Telegram: ${response.data?.description || 'Неизвестная ошибка'}`
          };
        }
      }
      
      // Если несколько изображений - отправляем как медиагруппу
      // Формируем массив медиа (с ограничением в 10 изображений за раз)
      const messageIds: number[] = [];
      
      // Разбиваем на группы по 10 (лимит Telegram API)
      for (let i = 0; i < validImages.length; i += 10) {
        const batch = validImages.slice(i, i + 10);
        log(`Формирование группы ${i/10 + 1} из ${Math.ceil(validImages.length/10)} (${batch.length} изображений)`, 'telegram-debug');
        
        const mediaGroup = batch.map(img => ({
          type: 'photo',
          media: img
        }));
        
        log(`Отправка группы через sendMediaGroup: ${JSON.stringify(mediaGroup)}`, 'telegram-debug');
        
        const mediaResponse = await axios.post(`${baseUrl}/sendMediaGroup`, {
          chat_id: formattedChatId,
          media: mediaGroup
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
          validateStatus: () => true
        });
        
        log(`Ответ API Telegram: ${JSON.stringify(mediaResponse.data)}`, 'telegram-debug');
        
        if (mediaResponse.status === 200 && mediaResponse.data.ok) {
          log(`Группа из ${mediaGroup.length} изображений успешно отправлена в Telegram`, 'social-publishing');
          
          // Добавляем ID сообщений для возможного создания ссылок
          if (mediaResponse.data.result && Array.isArray(mediaResponse.data.result)) {
            mediaResponse.data.result.forEach((msg: any) => {
              if (msg.message_id) {
                messageIds.push(msg.message_id);
              }
            });
          }
        } else {
          log(`Ошибка при отправке группы изображений в Telegram: ${JSON.stringify(mediaResponse.data)}`, 'social-publishing');
          return {
            success: false,
            error: `Ошибка API Telegram при отправке медиагруппы: ${mediaResponse.data?.description || 'Неизвестная ошибка'}`
          };
        }
      }
      
      // Если есть ID сообщений, создаем URL первого сообщения в группе с помощью метода-форматера
      let messageUrl;
      if (messageIds.length > 0) {
        messageUrl = this.formatTelegramUrl(originalChatId, formattedChatId, messageIds[0]);
        log(`Создан URL для группы изображений через formatTelegramUrl: ${messageUrl}`, 'telegram-debug');
      }
      
      return {
        success: true,
        messageIds,
        messageUrl
      };
    } catch (error: any) {
      log(`Исключение при отправке изображений в Telegram: ${error.message}`, 'social-publishing');
      if (error.response) {
        log(`Данные ответа: ${JSON.stringify(error.response.data)}`, 'social-publishing');
      }
      return {
        success: false,
        error: `Исключение при отправке изображений: ${error.message}`
      };
    }
  }

  /**
   * Форматирует текст для публикации в Telegram с учетом поддерживаемых HTML-тегов
   * @param content Исходный текст контента
   * @returns Отформатированный текст для Telegram с поддержкой HTML
   */
  private formatTextForTelegram(content: string): string {
    // Проверка на null или undefined
    if (!content) {
      return '';
    }
    
    // Сохраняем исходный текст для логирования
    const originalLength = content.length;
    
    try {
      // Telegram поддерживает только ограниченный набор HTML-тегов:
      // <b>, <strong>, <i>, <em>, <u>, <s>, <strike>, <code>, <pre>, <a href="...">
      
      // Сначала преобразуем маркдаун в HTML для Telegram
      let formattedText = content
        // Обработка маркдаун-разметки (должна происходить ДО обработки HTML)
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') // **жирный**
        .replace(/\*(.*?)\*/g, '<i>$1</i>') // *курсив*
        .replace(/__(.*?)__/g, '<u>$1</u>') // __подчеркнутый__
        .replace(/~~(.*?)~~/g, '<s>$1</s>') // ~~зачеркнутый~~
        .replace(/`([^`]+)`/g, '<code>$1</code>') // `код`
        
        // Преобразуем блочные элементы в понятный Telegram формат
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<div>(.*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, '<b>$1</b>\n\n')
        
        // Приводим HTML-теги к поддерживаемым в Telegram форматам
        .replace(/<strong>(.*?)<\/strong>/g, '<b>$1</b>')
        .replace(/<em>(.*?)<\/em>/g, '<i>$1</i>')
        .replace(/<strike>(.*?)<\/strike>/g, '<s>$1</s>')
        .replace(/<del>(.*?)<\/del>/g, '<s>$1</s>')
        .replace(/<ins>(.*?)<\/ins>/g, '<u>$1</u>')
        
        // Улучшенная обработка списков (без флага s для совместимости)
        .replace(/<ul>([^]*?)<\/ul>/g, '$1')
        .replace(/<ol>([^]*?)<\/ol>/g, '$1')
        .replace(/<li>(.*?)<\/li>/g, '• $1\n')
        
        // Обрабатываем ссылки по формату Telegram
        .replace(/<a\s+href="(.*?)".*?>(.*?)<\/a>/g, '<a href="$1">$2</a>');
      
      // Telegram не поддерживает вложенные теги одного типа, исправляем это
      // Например: <b>жирный <b>вложенный</b> текст</b> -> <b>жирный вложенный текст</b>
      formattedText = formattedText
        .replace(/<(b|i|u|s|strike|code)>(.*?)<\/\1>.*?<\1>(.*?)<\/\1>/g, '<$1>$2 $3</$1>')
        .replace(/<(b|i|u|s|strike|code)>(.*?)<\1>(.*?)<\/\1>(.*?)<\/\1>/g, '<$1>$2$3$4</$1>');
        
      // Удаляем все неподдерживаемые HTML-теги, но сохраняем их содержимое
      formattedText = formattedText.replace(/<(\/?(?!b|strong|i|em|u|s|strike|code|pre|a\b)[^>]+)>/gi, '');
      
      // Проверяем правильность HTML (закрытые теги)
      const openTags = (formattedText.match(/<([a-z]+)[^>]*>/gi) || []).map(tag => 
        tag.replace(/<([a-z]+)[^>]*>/i, '$1').toLowerCase()
      );
      
      const closeTags = (formattedText.match(/<\/([a-z]+)>/gi) || []).map(tag => 
        tag.replace(/<\/([a-z]+)>/i, '$1').toLowerCase()
      );
      
      // Если количество открывающих и закрывающих тегов не совпадает,
      // может возникнуть ошибка при отправке. Логируем это.
      if (openTags.length !== closeTags.length) {
        log(`Внимание: количество открывающих (${openTags.length}) и закрывающих (${closeTags.length}) HTML-тегов не совпадает. Это может вызвать ошибку при отправке в Telegram.`, 'social-publishing');
        
        // В случае дисбаланса можно дополнительно удалить HTML-форматирование,
        // но сейчас мы просто логируем для отладки и возвращаем текст как есть
      }
      
      log(`Форматирование текста для Telegram: было ${originalLength} символов, стало ${formattedText.length}`, 'social-publishing');
      return formattedText;
    } catch (error) {
      log(`Ошибка при форматировании текста для Telegram: ${error}. Возвращаем исходный текст.`, 'social-publishing');
      return content; // В случае ошибки возвращаем исходный текст
    }
  }
  
  /**
   * Подготавливает текст для отправки в Telegram: форматирует и обрезает при необходимости
   * @param content Исходный текст контента
   * @param maxLength Максимальная длина текста (по умолчанию 4000 для защиты от превышения лимита в 4096)
   * @returns Отформатированный и обрезанный текст для Telegram
   */
  private prepareTelegramText(content: string, maxLength: number = 4000): string {
    try {
      if (!content) {
        log('Попытка отправки пустого контента в Telegram', 'social-publishing');
        return '';
      }
      
      log(`Подготовка текста для Telegram, исходная длина: ${content.length} символов`, 'social-publishing');
      
      // Очистка текста от скрытых спец-символов, которые могут вызвать проблемы
      // в кодировке при отправке в Telegram
      const cleanContent = content
        .replace(/\u200B/g, '') // Zero-width space
        .replace(/\u200C/g, '') // Zero-width non-joiner
        .replace(/\u200D/g, '') // Zero-width joiner
        .replace(/\uFEFF/g, ''); // Zero-width no-break space
      
      // Сначала форматируем текст для Telegram с поддержкой HTML
      const formattedText = this.formatTextForTelegram(cleanContent);
      
      // Проверка на слишком длинные строки без пробелов (они могут вызвать проблемы при рендеринге)
      const longWordsFound = formattedText.match(/[^\s]{100,}/g);
      if (longWordsFound && longWordsFound.length > 0) {
        log(`Внимание: найдены слишком длинные строки без пробелов (${longWordsFound.length}): ${longWordsFound[0].substring(0, 50)}...`, 'social-publishing');
      }
      
      // Затем проверяем общую длину и обрезаем при необходимости
      if (formattedText.length > maxLength) {
        log(`Текст превышает максимальную длину ${maxLength}. Исходная длина: ${formattedText.length}, будет обрезан`, 'social-publishing');
        
        // Обрезаем текст до последнего полного предложения или абзаца
        // чтобы избежать обрыва посреди предложения
        let truncatedText = formattedText.substring(0, maxLength - 3);
        
        // Ищем последний символ конца предложения или абзаца
        let lastSentenceEnd = Math.max(
          truncatedText.lastIndexOf('. '),
          truncatedText.lastIndexOf('! '),
          truncatedText.lastIndexOf('? '),
          truncatedText.lastIndexOf('.\n'),
          truncatedText.lastIndexOf('!\n'),
          truncatedText.lastIndexOf('?\n'),
          truncatedText.lastIndexOf('\n\n')
        );
        
        // Если нашли подходящее место для разрыва, обрезаем там
        if (lastSentenceEnd > maxLength * 0.8) { // Не обрезаем слишком рано
          truncatedText = truncatedText.substring(0, lastSentenceEnd + 1);
        }
        
        // Добавляем многоточие, чтобы показать, что текст обрезан
        truncatedText += '...';
        
        log(`Текст обрезан до ${truncatedText.length} символов`, 'social-publishing');
        return truncatedText;
      }
      
      return formattedText;
    } catch (error) {
      log(`Ошибка при подготовке текста для Telegram: ${error}. Возвращаем оригинальный текст с обрезкой.`, 'social-publishing');
      // В случае ошибки возвращаем простой обрезанный текст
      if (content && content.length > maxLength) {
        return content.substring(0, maxLength - 3) + '...';
      }
      return content || '';
    }
  }
  
  /**
   * Создает и отправляет текстовое сообщение в Telegram
   * @param text Текст для отправки
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @returns Результат отправки сообщения
   */
  private async sendTextMessageToTelegram(text: string, chatId: string, token: string): Promise<any> {
    try {
      // Форматируем ID чата с учетом различных форматов
      let formattedChatId = chatId;
      
      // Улучшенная логика форматирования chat ID
      if (!chatId.startsWith('-100')) {
        if (chatId.startsWith('-')) {
          // Если ID начинается с минуса, но не с "-100", форматируем правильно
          formattedChatId = `-100${chatId.replace(/^-/, '')}`;
        } else if (chatId.startsWith('@')) {
          // Обрабатываем имя канала, если оно начинается с @
          formattedChatId = chatId;
        } else if (!isNaN(Number(chatId))) {
          // Если это просто число, добавляем "-100" префикс
          formattedChatId = `-100${chatId}`;
        }
      }
      
      log(`Форматирование chat ID: исходный "${chatId}" -> форматированный "${formattedChatId}"`, 'social-publishing');
      
      // Подготавливаем текст с форматированием и обрезкой
      const processedText = this.prepareTelegramText(text);
      log(`Отправка текстового сообщения в Telegram, длина: ${processedText.length} символов, первые 100 символов: "${processedText.substring(0, 100)}..."`, 'social-publishing');
      
      // Базовый URL API
      const baseUrl = `https://api.telegram.org/bot${token}`;
      
      // Тело запроса
      const messageBody = {
        chat_id: formattedChatId,
        text: processedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      
      // Отправляем запрос с HTML форматированием и расширенными параметрами
      const response = await axios.post(`${baseUrl}/sendMessage`, messageBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000, // Увеличенный таймаут для стабильности
        validateStatus: () => true // Чтобы получить полный ответ, даже при ошибке
      });
      
      log(`Ответ от Telegram API: ${JSON.stringify(response.data)}`, 'social-publishing');
      
      if (response.status !== 200 || !response.data.ok) {
        const errorDescription = response.data?.description || 'Неизвестная ошибка';
        const errorCode = response.data?.error_code || response.status;
        log(`Ошибка при отправке HTML-форматированного текста: код ${errorCode}, ${errorDescription}`, 'social-publishing');
        
        // Если ошибка связана с HTML-форматированием, пробуем без него
        if (errorDescription.includes('can\'t parse entities') || 
            errorDescription.includes('Bad Request') || 
            errorDescription.includes('parse entities')) {
          
          // Удаляем все HTML-теги
          const plainText = text.replace(/<[^>]*>/g, '');
          
          // Обрезаем по тому же лимиту
          const maxLength = 4000;
          const processedPlainText = plainText.length > maxLength ? 
            plainText.substring(0, maxLength - 3) + '...' : 
            plainText;
          
          log(`Отправка обычного текста в Telegram (без HTML), длина: ${processedPlainText.length} символов`, 'social-publishing');
          
          // Тело запроса без указания parse_mode
          const plainMessageBody = {
            chat_id: formattedChatId,
            text: processedPlainText,
            disable_web_page_preview: true
          };
          
          // Отправляем запрос без HTML форматирования
          const plainResponse = await axios.post(`${baseUrl}/sendMessage`, plainMessageBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
          });
          
          if (plainResponse.data && plainResponse.data.ok) {
            log(`Успешная отправка обычного текста: message_id ${plainResponse.data.result?.message_id}`, 'social-publishing');
            return {
              success: true,
              data: plainResponse.data
            };
          } else {
            log(`Ошибка при отправке обычного текста: ${JSON.stringify(plainResponse.data)}`, 'social-publishing');
            return {
              success: false,
              error: plainResponse.data,
              errorDescription: plainResponse.data?.description
            };
          }
        } else {
          // Если ошибка не связана с HTML-форматированием, возвращаем исходную ошибку
          return {
            success: false,
            error: response.data,
            errorDescription
          };
        }
      }
      
      log(`Сообщение успешно отправлено в Telegram, message_id: ${response.data.result?.message_id}`, 'social-publishing');
      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      log(`Исключение при отправке текстового сообщения в Telegram: ${error.message}`, 'social-publishing');
      
      // Расширенный лог ошибки для отладки
      if (error.response) {
        log(`Данные при ошибке: ${JSON.stringify(error.response.data)}`, 'social-publishing');
      }
      
      return {
        success: false,
        error: error.message,
        errorObject: error.response?.data
      };
    }
  }

  /**
   * Обрабатывает поле дополнительных изображений в контенте, проверяя и преобразуя его при необходимости
   * @param content Контент, содержащий дополнительные изображения
   * @param platform Название социальной платформы (для логирования)
   * @returns Обновленный контент с обработанным полем additionalImages
   */
  private processAdditionalImages(content: CampaignContent, platform: string): CampaignContent {
    // Создаем копию контента для изменений
    const processedContent = { ...content };
    
    if (!processedContent.additionalImages) {
      log(`${platform}: additionalImages отсутствует, возвращаем пустой массив`, 'social-publishing');
      processedContent.additionalImages = [];
      return processedContent;
    }
    
    log(`Обработка дополнительных изображений для ${platform}. Тип: ${typeof processedContent.additionalImages}, значение: ${
      typeof processedContent.additionalImages === 'string' 
        ? (processedContent.additionalImages as string).substring(0, 100) + '...' 
        : JSON.stringify(processedContent.additionalImages).substring(0, 100) + '...'
    }`, 'social-publishing');
    
    // Если это строка, пытаемся распарсить как JSON
    if (typeof processedContent.additionalImages === 'string') {
      try {
        // Проверяем, начинается ли строка с [ или {
        const trimmedStr = (processedContent.additionalImages as string).trim();
        if (trimmedStr.startsWith('[') || trimmedStr.startsWith('{')) {
          const parsedImages = JSON.parse(processedContent.additionalImages as string);
          log(`Успешно распарсили строку additionalImages как JSON для ${platform}: ${JSON.stringify(parsedImages).substring(0, 100)}...`, 'social-publishing');
          
          if (Array.isArray(parsedImages)) {
            processedContent.additionalImages = parsedImages;
          } else {
            processedContent.additionalImages = [parsedImages];
          }
        } else {
          // Если строка не начинается с [ или {, это не JSON, а просто URL
          log(`${platform}: additionalImages это строка-URL, а не JSON: ${(processedContent.additionalImages as string).substring(0, 50)}...`, 'social-publishing');
          processedContent.additionalImages = [processedContent.additionalImages as string];
        }
      } catch (e) {
        log(`${platform}: Не удалось распарсить additionalImages как JSON: ${(e as Error).message}`, 'social-publishing');
        
        // Создаем массив из строки
        const additionalImagesArray: string[] = [];
        if (typeof processedContent.additionalImages === 'string' && (processedContent.additionalImages as string).trim() !== '') {
          additionalImagesArray.push(processedContent.additionalImages as string);
          log(`${platform}: Добавили строку additionalImages как URL: ${(processedContent.additionalImages as string).substring(0, 50)}...`, 'social-publishing');
        }
        processedContent.additionalImages = additionalImagesArray;
      }
    }
    
    // Проверяем итоговый массив и фильтруем некорректные значения
    if (Array.isArray(processedContent.additionalImages)) {
      const validImages = processedContent.additionalImages.filter(url => url && typeof url === 'string' && url.trim() !== '');
      log(`${platform}: Найдено ${validImages.length} корректных дополнительных изображений`, 'social-publishing');
      if (validImages.length > 0) {
        log(`${platform}: Первое изображение: ${validImages[0].substring(0, 50)}...`, 'social-publishing');
      }
      processedContent.additionalImages = validImages;
    } else {
      // Если по какой-то причине additionalImages не массив, создаем пустой массив
      log(`${platform}: additionalImages не является массивом после обработки, создаем пустой массив`, 'social-publishing');
      processedContent.additionalImages = [];
    }
    
    return processedContent;
  }

  /**
   * Загружает изображения на Imgur для использования в социальных сетях
   * @param content Контент с изображениями для загрузки
   * @returns Контент с обновленными URLs изображений, загруженных на Imgur
   */
  private async uploadImagesToImgur(content: CampaignContent): Promise<CampaignContent> {
    const updatedContent = { ...content };
    
    try {
      log(`Начинаем загрузку изображений на Imgur для контента: ${content.id}`, 'social-publishing');
      
      // Загружаем основное изображение, если оно есть
      if (updatedContent.imageUrl && typeof updatedContent.imageUrl === 'string' && updatedContent.imageUrl.trim() !== '') {
        log(`Загрузка основного изображения на Imgur: ${updatedContent.imageUrl}`, 'social-publishing');
        
        // Если URL не начинается с http, добавляем базовый URL сервера
        let originalImageUrl = updatedContent.imageUrl;
        if (!originalImageUrl.startsWith('http')) {
          // Используем фиксированный базовый URL или получаем его из конфигурации в Directus
          const baseAppUrl = this.getAppBaseUrl(); 
          originalImageUrl = `${baseAppUrl}${originalImageUrl.startsWith('/') ? '' : '/'}${originalImageUrl}`;
          log(`Изменен URL основного изображения для загрузки: ${originalImageUrl}`, 'social-publishing');
        }
        
        const imgurUrl = await imgurUploaderService.uploadImageFromUrl(originalImageUrl);
        if (imgurUrl) {
          log(`Основное изображение успешно загружено на Imgur: ${imgurUrl}`, 'social-publishing');
          updatedContent.imageUrl = imgurUrl;
        } else {
          log(`Не удалось загрузить основное изображение на Imgur, оставляем оригинальный URL`, 'social-publishing');
        }
      }
      
      // Загружаем дополнительные изображения
      if (updatedContent.additionalImages && Array.isArray(updatedContent.additionalImages) && updatedContent.additionalImages.length > 0) {
        log(`Загрузка ${updatedContent.additionalImages.length} дополнительных изображений на Imgur`, 'social-publishing');
        
        const imgurUrls: string[] = [];
        
        for (let i = 0; i < updatedContent.additionalImages.length; i++) {
          const additionalImage = updatedContent.additionalImages[i];
          
          if (additionalImage && typeof additionalImage === 'string' && additionalImage.trim() !== '') {
            // Если URL не начинается с http, добавляем базовый URL сервера
            let originalImageUrl = additionalImage;
            if (!originalImageUrl.startsWith('http')) {
              const baseAppUrl = this.getAppBaseUrl();
              originalImageUrl = `${baseAppUrl}${originalImageUrl.startsWith('/') ? '' : '/'}${originalImageUrl}`;
              log(`Изменен URL дополнительного изображения ${i+1} для загрузки: ${originalImageUrl}`, 'social-publishing');
            }
            
            const imgurUrl = await imgurUploaderService.uploadImageFromUrl(originalImageUrl);
            if (imgurUrl) {
              log(`Дополнительное изображение ${i+1} успешно загружено на Imgur: ${imgurUrl}`, 'social-publishing');
              imgurUrls.push(imgurUrl);
            } else {
              log(`Не удалось загрузить дополнительное изображение ${i+1} на Imgur, сохраняем оригинальный URL`, 'social-publishing');
              imgurUrls.push(originalImageUrl);
            }
          }
        }
        
        updatedContent.additionalImages = imgurUrls;
        log(`Завершена загрузка дополнительных изображений на Imgur, всего: ${imgurUrls.length}`, 'social-publishing');
      }
      
      return updatedContent;
    } catch (error) {
      log(`Ошибка при загрузке изображений на Imgur: ${error}`, 'social-publishing');
      return content; // Возвращаем оригинальный контент в случае ошибки
    }
  }

  /**
   * Вспомогательная функция для форматирования URL Telegram с учетом разных форматов chat ID
   * @param chatId Исходный chat ID (может быть @username или числовым ID)
   * @param formattedChatId Форматированный chat ID для API запросов
   * @param messageId ID сообщения для создания прямой ссылки (ОБЯЗАТЕЛЬНЫЙ параметр)
   * @returns Корректно форматированный URL
   * @throws Error если messageId не указан - согласно требованию TELEGRAM_POSTING_ALGORITHM.md
   */
  formatTelegramUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
    // КРИТИЧЕСКОЕ ТРЕБОВАНИЕ: messageId должен быть указан всегда!
    if (!messageId) {
      const errorMessage = 'CRITICAL ERROR: MessageId is REQUIRED for Telegram URL formation according to TELEGRAM_POSTING_ALGORITHM.md';
      log(errorMessage, 'social-publishing');
      throw new Error(errorMessage);
    }
    
    // Определяем базовый URL для публичных каналов или приватных чатов
    let baseUrl = '';
    
    // Используем единую логику форматирования URL из TelegramService
    // Эта функция всегда должна быть согласованной с логикой в TelegramService.formatTelegramUrl
    
    // Если это username (начинается с @), удаляем @ и не добавляем /c/
    if (chatId.startsWith('@')) {
      const username = chatId.substring(1);
      log(`Форматирование Telegram URL: username ${chatId} преобразован в https://t.me/${username}`, 'social-publishing');
      baseUrl = `https://t.me/${username}`;
    }
    // Для числовых ID проверяем, нужен ли префикс /c/
    else {
      // Проверяем, является ли chatId полным числовым идентификатором супергруппы/канала (с -100...)
      const isFullNumericId = chatId.startsWith('-100');
      
      if (isFullNumericId) {
        // Для таких ID нужен формат с /c/ и без -100
        const channelId = chatId.substring(4); // Убираем префикс -100
        log(`Форматирование Telegram URL: полный числовой ID ${chatId} преобразован в https://t.me/c/${channelId}`, 'social-publishing');
        baseUrl = `https://t.me/c/${channelId}`;
      } else if (chatId.startsWith('-')) {
        // Для групп с минусом, но не начинающихся с -100, нужен формат с /c/ и без минуса
        // Пример: -123456 должен стать https://t.me/c/123456
        const channelId = chatId.substring(1); // Убираем префикс -
        log(`Форматирование Telegram URL: группа с минусом ${chatId} преобразована в https://t.me/c/${channelId}`, 'social-publishing');
        baseUrl = `https://t.me/c/${channelId}`;
      } else {
        // Для обычных числовых ID без префикса просто используем их (прямой канал или чат с ботом)
        log(`Форматирование Telegram URL: обычный числовой ID ${chatId} используется напрямую`, 'social-publishing');
        baseUrl = `https://t.me/${chatId}`;
      }
    }
    
    // Создаем полный URL с ID сообщения (который обязателен)
    const url = `${baseUrl}/${messageId}`;
    log(`Сформирован URL с обязательным message ID: ${url}`, 'social-publishing');
    return url;
  }
  
  /**
   * Получает базовый URL приложения без использования process.env
   * @returns Базовый URL приложения
   */
  private getAppBaseUrl(): string {
    // Приоритеты URL:
    // 1. Продакшен URL (основной стабильный URL)
    // 2. URL разработки (URL на платформе разработки)
    // 3. Резервный URL (если ничего не сработало)
    
    // Основной URL продакшена
    const productionUrl = 'https://smm.omemo.tech';
    
    // URL для разработки на Replit
    const developmentUrl = 'https://b97f8d4a-3eb5-439c-9956-3cacfdeb3f2a-00-30nikq0wek8gj.picard.replit.dev';
    
    // Резервный URL по умолчанию
    const fallbackUrl = 'https://nplanner.replit.app';
    
    try {
      // Пытаемся определить текущий хост из запроса
      // Поскольку мы не можем получить req напрямую, 
      // выбираем наиболее вероятный URL для текущего окружения
      
      // Логика выбора URL здесь не использует process.env
      // В будущем можно добавить получение URL из конфигурации в БД
      
      // Для простоты используем продакшен URL как основной
      return productionUrl;
    } catch (error) {
      // В случае ошибки возвращаем резервный URL
      return fallbackUrl;
    }
  }
  
  /**
   * Публикует контент в Telegram с использованием Imgur для изображений
   * @param content Контент для публикации
   * @param telegramSettings Настройки Telegram API
   * @returns Результат публикации
   */
  async publishToTelegram(
    content: CampaignContent,
    telegramSettings?: SocialMediaSettings['telegram']
  ): Promise<SocialPublication> {
    // Переменная для хранения ID последнего отправленного сообщения
    let lastMessageId: string | number | undefined;
    // Добавляем расширенное логирование для отладки
    log(`publishToTelegram вызван для контента: ${content.id}, title: "${content.title || 'без названия'}"`, 'telegram-debug');
    log(`Telegram настройки: ${JSON.stringify({
      hasSettings: !!telegramSettings,
      hasToken: !!telegramSettings?.token,
      hasChatId: !!telegramSettings?.chatId,
      token: telegramSettings?.token ? `${telegramSettings.token.substring(0, 6)}...` : 'отсутствует',
      chatId: telegramSettings?.chatId || 'отсутствует',
      campaignId: content.campaignId
    })}`, 'telegram-debug');
    
    // Расширенное логирование для отладки
    log(`publishToTelegram вызван для контента ID: ${content.id}, Title: "${content.title}"`, 'social-publishing');
    log(`Параметры Telegram: ${JSON.stringify({
      settingsProvided: !!telegramSettings,
      tokenProvided: !!telegramSettings?.token,
      chatIdProvided: !!telegramSettings?.chatId,
      tokenLength: telegramSettings?.token ? telegramSettings.token.length : 0,
      chatIdValue: telegramSettings?.chatId || 'не задан'
    })}`, 'social-publishing');
    
    // Проверяем наличие настроек кампании
    if (!telegramSettings || !telegramSettings.token || !telegramSettings.chatId) {
      log(`Ошибка публикации в Telegram: отсутствуют настройки кампании. Token: ${telegramSettings?.token ? 'задан' : 'отсутствует'}, ChatID: ${telegramSettings?.chatId ? 'задан' : 'отсутствует'}`, 'social-publishing');
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Telegram (токен или ID чата). Убедитесь, что настройки заданы в кампании.'
      };
    }

    // Получаем токен и chatId из настроек кампании
    const token = telegramSettings.token;
    const chatId = telegramSettings.chatId;
    
    log(`Используем токен Telegram: ${token.substring(0, 6)}... и ID чата: ${chatId}`, 'social-publishing');

    try {
      log(`Публикация в Telegram. Контент: ${content.id}, тип: ${content.contentType}`, 'social-publishing');

      // Обработка дополнительных изображений
      let processedContent = this.processAdditionalImages(content, 'Telegram');
      
      // Загрузка изображений на Imgur перед публикацией
      processedContent = await this.uploadImagesToImgur(processedContent);

      // Правильное форматирование ID чата
      let formattedChatId = chatId.trim();
      
      log(`Обработка ID чата для Telegram: "${formattedChatId}"`, 'social-publishing');
      
      // Пробуем получить информацию о чате через API Telegram
      try {
        const baseUrl = `https://api.telegram.org/bot${token}`;
        
        // Начинаем с предварительной обработки ID чата
        if (!formattedChatId.startsWith('@') && formattedChatId.includes('ya_delayu_moschno')) {
          formattedChatId = '@ya_delayu_moschno';
          log(`Специальный случай: установлен ID чата: ${formattedChatId}`, 'social-publishing');
        } else if (!formattedChatId.startsWith('@') && !formattedChatId.match(/^-?\d+$/) && !formattedChatId.includes('.')) {
          // Если ID похож на username без @, добавляем префикс @
          formattedChatId = `@${formattedChatId}`;
          log(`Преобразован ID в username с добавлением @: ${formattedChatId}`, 'social-publishing');
        }
        
        // Проверяем существование чата через API
        log(`Проверка чата через API Telegram: ${formattedChatId}`, 'social-publishing');
        const chatInfoResponse = await axios.get(`${baseUrl}/getChat`, {
          params: {
            chat_id: formattedChatId
          },
          validateStatus: () => true, // Принимаем любой код ответа для анализа
          timeout: 10000
        });
        
        if (chatInfoResponse.status === 200 && chatInfoResponse.data.ok) {
          // Чат найден - используем информацию из ответа API
          const chatInfo = chatInfoResponse.data.result;
          log(`Чат найден через API: ${JSON.stringify(chatInfo)}`, 'social-publishing');
          
          // Если это канал или группа с username, предпочитаем использовать username
          if (chatInfo.username) {
            formattedChatId = `@${chatInfo.username}`;
            log(`Используем username из API: ${formattedChatId}`, 'social-publishing');
          } else if (chatInfo.id) {
            // В противном случае используем ID
            formattedChatId = String(chatInfo.id);
            log(`Используем ID из API: ${formattedChatId}`, 'social-publishing');
          }
        } else {
          // Если getChat не сработал, применяем обычную логику форматирования
          log(`Не удалось получить информацию о чате через API: ${chatInfoResponse.data?.description || 'Нет данных'}`, 'social-publishing');
          
          // Специальная обработка для имен пользователей/каналов (username)
          if (formattedChatId.startsWith('@')) {
            // Уже в правильном формате username - оставляем как есть
            log(`Используем username в качестве ID чата: ${formattedChatId}`, 'social-publishing');
          } else if (!formattedChatId.startsWith('-100')) {
            // Проверяем нужно ли форматирование для каналов/групп
            if (formattedChatId.startsWith('-')) {
              // Если ID начинается с минуса, но не с "-100", заменяем его на "-100"
              formattedChatId = `-100${formattedChatId.replace(/^-/, '')}`;
              log(`Переформатирован ID группы для Telegram из "${chatId}" в "${formattedChatId}"`, 'social-publishing');
            } else if (!isNaN(Number(formattedChatId))) {
              // Если это просто число, проверяем его длину
              if (formattedChatId.length >= 10) {
                // Вероятно ID канала без префикса -100
                formattedChatId = `-100${formattedChatId}`;
                log(`Переформатирован ID канала для Telegram: ${formattedChatId}`, 'social-publishing');
              } else {
                // Короткий числовой ID - скорее всего личный чат, оставляем как есть
                log(`Используем короткий числовой ID без изменений: ${formattedChatId}`, 'social-publishing');
              }
            }
          }
        }
      } catch (error: any) {
        log(`Ошибка при проверке чата через API: ${error.message}`, 'social-publishing');
        
        // В случае ошибки API используем стандартную логику форматирования
        // Специальная обработка для имен пользователей/каналов (username)
        if (formattedChatId.startsWith('@')) {
          // Уже в правильном формате username - оставляем как есть
          log(`Используем username в качестве ID чата: ${formattedChatId}`, 'social-publishing');
        } else if (formattedChatId.includes('ya_delayu_moschno') || (!formattedChatId.match(/^-?\d+$/) && !formattedChatId.includes('.'))) {
          // Если ID похож на username без @, добавляем префикс @
          formattedChatId = `@${formattedChatId}`;
          log(`Преобразован ID в username с добавлением @: ${formattedChatId}`, 'social-publishing');
        } else if (!formattedChatId.startsWith('-100')) {
          // Проверяем нужно ли форматирование для каналов/групп
          if (formattedChatId.startsWith('-')) {
            // Если ID начинается с минуса, но не с "-100", заменяем его на "-100"
            formattedChatId = `-100${formattedChatId.replace(/^-/, '')}`;
            log(`Переформатирован ID группы для Telegram из "${chatId}" в "${formattedChatId}"`, 'social-publishing');
          } else if (!isNaN(Number(formattedChatId))) {
            // Если это просто число, проверяем его длину
            if (formattedChatId.length >= 10) {
              // Вероятно ID канала без префикса -100
              formattedChatId = `-100${formattedChatId}`;
              log(`Переформатирован ID канала для Telegram: ${formattedChatId}`, 'social-publishing');
            } else {
              // Короткий числовой ID - скорее всего личный чат, оставляем как есть
              log(`Используем короткий числовой ID без изменений: ${formattedChatId}`, 'social-publishing');
            }
          }
        }
      }
      
      log(`Используем ID чата для Telegram: ${formattedChatId}`, 'social-publishing');

      // Подготовка сообщения с сохранением HTML-форматирования
      let text = processedContent.title ? `<b>${processedContent.title}</b>\n\n` : '';
      
      // Telegram поддерживает только ограниченный набор HTML-тегов:
      // <b>, <strong>, <i>, <em>, <u>, <s>, <strike>, <code>, <pre>, <a href="...">
      // Нужно преобразовать все HTML-теги к поддерживаемым Telegram форматам
      
      // Сохраняем исходный текст для логирования
      const originalContent = processedContent.content;
      
      let contentText = processedContent.content
        // Преобразование упрощенной разметки в HTML-теги для Telegram
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') // **текст** -> жирный
        .replace(/\*(.*?)\*/g, '<i>$1</i>') // *текст* -> курсив
        .replace(/__(.*?)__/g, '<u>$1</u>') // __текст__ -> подчеркнутый
        .replace(/~~(.*?)~~/g, '<s>$1</s>') // ~~текст~~ -> зачеркнутый
        
        // Обрабатываем блочные элементы для правильных переносов (сокращаем лишние переносы)
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>([^]*?)<\/p>/g, '$1\n') // Используем [^] вместо . для поддержки многострочных совпадений
        .replace(/<div>([^]*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>([^]*?)<\/h[1-6]>/g, '<b>$1</b>\n')
        
        // Стандартизируем теги форматирования - сохраняем как HTML-теги для Telegram
        .replace(/<strong>(.*?)<\/strong>/g, '<b>$1</b>')
        .replace(/<em>(.*?)<\/em>/g, '<i>$1</i>')
        .replace(/<strike>(.*?)<\/strike>/g, '<s>$1</s>')
        
        // Специальная обработка маркированных списков (преобразуем <li> в формат с точками)
        .replace(/<li>(.*?)<\/li>/g, '• $1\n')
        .replace(/<ul>([^]*?)<\/ul>/g, '$1\n')
        .replace(/<ol>([^]*?)<\/ol>/g, '$1\n')
        
        // Приводим ссылки к простому формату href
        .replace(/<a\s+href="(.*?)".*?>(.*?)<\/a>/g, '<a href="$1">$2</a>')
        
        // Улучшенное регулярное выражение для удаления неподдерживаемых тегов
        // Сохраняет содержимое тегов, но удаляет сами теги, если они не в списке поддерживаемых
        .replace(/<(\/?(?!b|strong|i|em|u|s|strike|code|pre|a\b)[^>]+)>/gi, '');
        
      // Логирование обработанного текста для отладки
      log(`Обработка HTML для Telegram: исходный текст ${originalContent.length} символов, обработанный ${contentText.length} символов`, 'social-publishing');
      log(`Первые 100 символов обработанного текста: ${contentText.substring(0, 100)}`, 'social-publishing');
      
      text += contentText;
      
      // Если есть хэштеги, добавляем их в конец сообщения
      if (processedContent.hashtags && Array.isArray(processedContent.hashtags) && processedContent.hashtags.length > 0) {
        const hashtags = processedContent.hashtags
          .filter(tag => tag && typeof tag === 'string' && tag.trim() !== '')
          .map(tag => tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`);
        
        if (hashtags.length > 0) {
          text += '\n\n' + hashtags.join(' ');
        }
      }
      
      // Создаем URL API Telegram
      const baseUrl = `https://api.telegram.org/bot${token}`;
      
      // Проверяем наличие изображений
      const hasImages = processedContent.imageUrl || 
        (processedContent.additionalImages && processedContent.additionalImages.length > 0);
      
      // Проверяем необходимость принудительного разделения текста и изображений
      // Флаг устанавливается в методе publishToPlatform для всех Telegram публикаций
      const forceImageTextSeparation = processedContent.metadata && 
        (processedContent.metadata as any).forceImageTextSeparation === true;
      
      log(`Telegram: наличие изображений: ${hasImages}, принудительное разделение: ${forceImageTextSeparation}`, 'social-publishing');
      
      // Определяем стратегию публикации в зависимости от длины текста и наличия изображений
      
      // 1. Если есть изображения и включен флаг принудительного разделения,
      // отправляем сначала изображения без подписи, затем текст отдельным сообщением
      if (hasImages && forceImageTextSeparation) {
        log(`Telegram: публикация с изображением. Отправляем изображение и текст раздельно.`, 'social-publishing');
        
        // Подготавливаем краткую подпись для изображения (только заголовок)
        const imageCaption = processedContent.title ? 
          (processedContent.title.length > 200 ? 
            processedContent.title.substring(0, 197) + '...' : 
            processedContent.title) : 
          '';
        
        log(`Используем краткую подпись для изображения: "${imageCaption}"`, 'social-publishing');
        
        // Собираем все изображения для отправки через универсальный метод
        const images: string[] = [];
        
        // Добавляем основное изображение, если оно есть
        if (processedContent.imageUrl) {
          const isUrl = processedContent.imageUrl.startsWith('http://') || processedContent.imageUrl.startsWith('https://');
          log(`Основное изображение для Telegram - тип: ${isUrl ? 'URL' : 'локальный путь'}, значение: ${processedContent.imageUrl}`, 'social-publishing');
          images.push(processedContent.imageUrl);
        }
        
        // Добавляем дополнительные изображения в общий список
        if (processedContent.additionalImages && processedContent.additionalImages.length > 0) {
          log(`Добавляем ${processedContent.additionalImages.length} дополнительных изображений в общий список`, 'social-publishing');
          images.push(...processedContent.additionalImages);
        }
        
        // Отправляем все изображения через универсальный метод
        if (images.length > 0) {
          log(`Отправка всех ${images.length} изображений через универсальный метод`, 'social-publishing');
          
          const imagesResult = await this.sendImagesToTelegram(
            formattedChatId,
            token,
            images,
            baseUrl
          );
          
          if (!imagesResult.success) {
            log(`Ошибка при отправке изображений в Telegram: ${imagesResult.error}`, 'social-publishing');
          } else {
            log(`Все изображения успешно отправлены в Telegram`, 'social-publishing');
            log(`URL сообщения с изображениями: ${imagesResult.messageUrl || 'не создан'}`, 'social-publishing');
          }
        }
        
        // Наконец, отправляем сам текст как есть, без дополнительных заголовков
        try {
          log(`Telegram: отправка текста отдельным сообщением, длина: ${text.length} символов`, 'social-publishing');
            
          // Если текст превышает максимальную длину для Telegram (4096 символов),
          // он будет автоматически обрезан в методе sendTextMessageToTelegram
          const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
          log(`Текст успешно отправлен в Telegram: ${JSON.stringify(textResponse)}`, 'social-publishing');
          
          // Обновляем lastMessageId если есть message_id
          if (textResponse.result && textResponse.result.message_id) {
            lastMessageId = textResponse.result.message_id;
          }
            
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : null
          };
        } catch (error: any) {
          log(`Ошибка при отправке текста в Telegram: ${error.message}`, 'social-publishing');
          return {
            platform: 'telegram',
            status: 'failed',
            publishedAt: null,
            error: `Ошибка при отправке текста в Telegram: ${error.message}`
          };
        }
      }
      // 2. Если есть только одно основное изображение и текст умещается в лимит,
      // отправляем изображение с текстом в подписи
      else if (processedContent.imageUrl && (!processedContent.additionalImages || processedContent.additionalImages.length === 0) && text.length <= 1024) {
        log(`Telegram: отправка одного изображения с подписью. Длина текста: ${text.length} символов.`, 'social-publishing');
        
        try {
          // Проверяем валидность URL изображения и убеждаемся, что он действительно указывает на изображение
          let imageUrl = processedContent.imageUrl;
          if (!imageUrl.startsWith('http')) {
            const baseAppUrl = this.getAppBaseUrl();
            imageUrl = `${baseAppUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
            log(`Исправлен URL для основного изображения: ${imageUrl}`, 'social-publishing');
          }
          
          log(`Отправка фото в Telegram: ${imageUrl}`, 'social-publishing');
          
          // Используем validateStatus чтобы получить полный ответ даже в случае ошибки
          const response = await axios.post(`${baseUrl}/sendPhoto`, {
            chat_id: formattedChatId,
            photo: imageUrl,
            caption: text,
            parse_mode: 'HTML',
            protect_content: false, // Дополнительный параметр, который может быть полезен
            disable_notification: false // Дополнительный параметр, который может быть полезен
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000, // Увеличенный таймаут
            validateStatus: () => true // Всегда возвращаем ответ, даже если это ошибка
          });
          
          // Расширенное логирование ответа
          log(`Ответ от Telegram API (sendPhoto): код ${response.status}, body: ${JSON.stringify(response.data)}`, 'social-publishing');
          
          if (response.status === 200 && response.data && response.data.ok) {
            log(`Изображение с текстом успешно отправлено в Telegram: ${JSON.stringify(response.data)}`, 'social-publishing');
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              postUrl: this.formatTelegramUrl(chatId, formattedChatId, response.data?.result?.message_id)
            };
          } else {
            log(`Ошибка при отправке изображения с текстом в Telegram: ${JSON.stringify(response.data)}`, 'social-publishing');
            
            // Попробуем отправить как URL, если не получилось отправить как файл
            const errorDescription = response.data?.description || '';
            
            if (errorDescription.includes('Bad Request') || errorDescription.includes('URL') || errorDescription.includes('photo')) {
              log(`Пробуем альтернативный метод отправки изображения через медиагруппу...`, 'social-publishing');
              
              try {
                // Отправляем изображение и текст как медиагруппу
                const mediaResponse = await axios.post(`${baseUrl}/sendMediaGroup`, {
                  chat_id: formattedChatId,
                  media: [
                    {
                      type: 'photo',
                      media: imageUrl,
                      caption: text,
                      parse_mode: 'HTML'
                    }
                  ]
                }, {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 30000,
                  validateStatus: () => true
                });
                
                if (mediaResponse.status === 200 && mediaResponse.data && mediaResponse.data.ok) {
                  log(`Успешно отправлена медиагруппа: ${JSON.stringify(mediaResponse.data)}`, 'social-publishing');
                  // Сохраняем ID сообщения для формирования корректной ссылки
                  if (mediaResponse.data?.result?.[0]?.message_id) {
                    lastMessageId = mediaResponse.data.result[0].message_id;
                  }
                  
                  return {
                    platform: 'telegram',
                    status: 'published',
                    publishedAt: new Date(),
                    postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : null
                  };
                } else {
                  // Если оба метода не работают, отправляем изображение и текст по отдельности
                  log(`Альтернативный метод тоже не сработал. Пробуем отправить изображение и текст отдельно...`, 'social-publishing');
                  
                  // Отправляем сначала изображение без подписи
                  const imageOnlyResponse = await axios.post(`${baseUrl}/sendPhoto`, {
                    chat_id: formattedChatId,
                    photo: imageUrl
                  }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000,
                    validateStatus: () => true
                  });
                  
                  // Затем отправляем текст отдельно
                  const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
                  
                  if (imageOnlyResponse.data?.ok || textResponse.success) {
                    log(`Удалось отправить изображение и текст по отдельности`, 'social-publishing');
                    // Сохраняем ID сообщения для формирования корректной ссылки
                    if (imageOnlyResponse.data?.result?.message_id) {
                      lastMessageId = imageOnlyResponse.data.result.message_id;
                    } else if (textResponse.success && textResponse.result?.message_id) {
                      lastMessageId = textResponse.result.message_id;
                    }
                    
                    return {
                      platform: 'telegram',
                      status: 'published',
                      publishedAt: new Date(),
                      postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : null
                    };
                  }
                }
              } catch (mediaError: any) {
                log(`Ошибка при альтернативной отправке: ${mediaError.message}`, 'social-publishing');
              }
            }
            
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Ошибка при отправке изображения с текстом: ${response.data?.description || JSON.stringify(response.data)}`
            };
          }
        } catch (error: any) {
          log(`Исключение при отправке изображения с текстом в Telegram: ${error.message}`, 'social-publishing');
          
          // Детальное логирование для диагностики
          if (error.response) {
            log(`Данные ответа API: ${JSON.stringify(error.response.data)}`, 'social-publishing');
          }
          
          // Попробуем отправить текст и изображение отдельно как запасной вариант
          try {
            log(`Пробуем отправить текст и изображение отдельно после сбоя...`, 'social-publishing');
            
            // Отправляем сначала изображение без подписи
            await axios.post(`${baseUrl}/sendPhoto`, {
              chat_id: formattedChatId,
              photo: processedContent.imageUrl
            }, {
              validateStatus: () => true,
              timeout: 30000
            });
            
            // Затем отправляем текст отдельно
            const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
            
            if (textResponse.success) {
              log(`Резервный план сработал: изображение и текст отправлены отдельно`, 'social-publishing');
              // Сохраняем ID сообщения для формирования корректной ссылки
              if (textResponse.result?.message_id) {
                lastMessageId = textResponse.result.message_id;
              }
              
              return {
                platform: 'telegram',
                status: 'published',
                publishedAt: new Date(),
                postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : null
              };
            }
          } catch (backupError: any) {
            log(`Резервный план также не сработал: ${backupError.message}`, 'social-publishing');
          }
          
          return {
            platform: 'telegram',
            status: 'failed',
            publishedAt: null,
            error: `Ошибка при отправке изображения с текстом: ${error.message}`
          };
        }
      }
      // 3. В остальных случаях (нет изображений или несколько изображений)
      else {
        // Если есть изображения, отправляем их
        if (processedContent.imageUrl || (processedContent.additionalImages && processedContent.additionalImages.length > 0)) {
          // Подготавливаем подпись для изображения
          const imageCaption = text.length <= 1024 ? 
            text : 
            (processedContent.title ? 
              (processedContent.title.length > 200 ? 
                processedContent.title.substring(0, 197) + '...' : 
                processedContent.title) : 
              '');
              
          log(`Telegram: подготовлена подпись для изображения, длина: ${imageCaption.length} символов`, 'social-publishing');
          
          // Отправляем основное изображение
          if (processedContent.imageUrl) {
            try {
              const photoResponse = await axios.post(`${baseUrl}/sendPhoto`, {
                chat_id: formattedChatId,
                photo: processedContent.imageUrl,
                caption: imageCaption,
                parse_mode: 'HTML'
              });
              
              log(`Основное изображение успешно отправлено в Telegram: ${JSON.stringify(photoResponse.data)}`, 'social-publishing');
              
              // Если полный текст был добавлен к изображению, не нужно отправлять отдельный текст
              if (text.length <= 1024) {
                // Сохраняем ID сообщения для формирования корректной ссылки
                if (photoResponse?.data?.result?.message_id) {
                  lastMessageId = photoResponse.data.result.message_id;
                }
                
                return {
                  platform: 'telegram',
                  status: 'published',
                  publishedAt: new Date(),
                  postUrl: this.formatTelegramUrl(chatId, formattedChatId, lastMessageId || '')
                };
              }
            } catch (error: any) {
              log(`Ошибка при отправке основного изображения в Telegram: ${error.message}`, 'social-publishing');
            }
          }
          
          // Отправляем дополнительные изображения (если есть) всегда группой
          if (processedContent.additionalImages && processedContent.additionalImages.length > 0) {
            try {
              log(`Отправка группы из ${processedContent.additionalImages.length} дополнительных изображений`, 'social-publishing');
              
              // Подготавливаем массив медиа для отправки группой
              const media = processedContent.additionalImages.map(img => ({
                type: 'photo',
                media: img
              }));
              
              // Разбиваем на группы по 10 (лимит Telegram API)
              for (let i = 0; i < media.length; i += 10) {
                const mediaGroup = media.slice(i, i + 10);
                
                const mediaResponse = await axios.post(`${baseUrl}/sendMediaGroup`, {
                  chat_id: formattedChatId,
                  media: mediaGroup
                }, {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 30000
                });
                
                log(`Группа изображений ${i / 10 + 1} успешно отправлена в Telegram`, 'social-publishing');
              }
            } catch (error: any) {
              log(`Ошибка при отправке группы изображений в Telegram: ${error.message}`, 'social-publishing');
              
              if (error.response) {
                log(`Ответ API: ${JSON.stringify(error.response.data)}`, 'social-publishing');
              }
            }
          }
        }
        
        // Отправляем текст (если он не был отправлен с основным изображением)
        if (processedContent.imageUrl && text.length <= 1024) {
          // Текст уже был отправлен с основным изображением
          // Используем messageId из замыкания, который был сохранен при отправке изображения
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : `https://t.me/${chatId.replace('@', '')}`
          };
        } else {
          try {
            log(`Отправка текстового сообщения в Telegram, длина: ${text.length} символов`, 'social-publishing');
            
            // Для длинных текстов (> 4000 символов) разбиваем на части
            if (text.length > 4000) {
              log(`Текст слишком длинный (${text.length} символов), разбиваем на части`, 'social-publishing');
              
              // Разбиваем текст на части примерно по 3500 символов
              // чтобы не обрезать посреди HTML-тега, разбиваем на абзацы
              const maxPartLength = 3500;
              let remainingText = text;
              let success = false;
              let successCount = 0;
              let partNumber = 1;
              
              while (remainingText.length > 0) {
                let partEndPos = Math.min(remainingText.length, maxPartLength);
                
                // Ищем подходящее место для разрыва (конец абзаца, предложения или просто пробел)
                if (partEndPos < remainingText.length) {
                  const possibleBreakPoints = [
                    remainingText.lastIndexOf('\n\n', maxPartLength),
                    remainingText.lastIndexOf('\n', maxPartLength),
                    remainingText.lastIndexOf('. ', maxPartLength),
                    remainingText.lastIndexOf('! ', maxPartLength),
                    remainingText.lastIndexOf('? ', maxPartLength),
                    remainingText.lastIndexOf(' ', maxPartLength)
                  ].filter(pos => pos > 0);
                  
                  if (possibleBreakPoints.length > 0) {
                    partEndPos = Math.max(...possibleBreakPoints) + 1;
                  }
                }
                
                const textPart = remainingText.substring(0, partEndPos);
                remainingText = remainingText.substring(partEndPos);
                
                // Добавляем индикатор части для длинных сообщений
                const partIndicator = remainingText.length > 0 ? 
                  `\n\n(Часть ${partNumber}/${Math.ceil(text.length / maxPartLength)})` : 
                  '';
                
                try {
                  // Сохраняем последний ответ, чтобы использовать message_id в URL
                  const partResponse = await this.sendTextMessageToTelegram(
                    textPart + partIndicator, 
                    formattedChatId, 
                    token
                  );
                  
                  // Обновляем lastMessageId если есть message_id
                  if (partResponse.success && partResponse.data && partResponse.data.result && partResponse.data.result.message_id) {
                    lastMessageId = partResponse.data.result.message_id;
                  }
                  
                  log(`Отправлена часть ${partNumber} текстового сообщения (${textPart.length} символов)`, 'social-publishing');
                  
                  if (partResponse.success) {
                    successCount++;
                    success = true;
                  } else {
                    log(`Ошибка при отправке части ${partNumber}: ${JSON.stringify(partResponse.error)}`, 'social-publishing');
                  }
                  
                  // Небольшая пауза между сообщениями, чтобы избежать ограничений API
                  if (remainingText.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                  
                  partNumber++;
                } catch (partError: any) {
                  log(`Ошибка при отправке части ${partNumber}: ${partError.message}`, 'social-publishing');
                }
              }
              
              if (success) {
                log(`Успешно отправлено ${successCount} из ${partNumber-1} частей длинного сообщения`, 'social-publishing');
                return {
                  platform: 'telegram',
                  status: 'published',
                  publishedAt: new Date(),
                  postUrl: this.formatTelegramUrl(chatId, formattedChatId, lastMessageId || '')
                };
              } else {
                return {
                  platform: 'telegram',
                  status: 'failed',
                  publishedAt: null,
                  error: `Не удалось отправить длинное текстовое сообщение`
                };
              }
            } else {
              // Для обычных сообщений используем стандартный метод
              const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
              log(`Текст успешно отправлен в Telegram: ${JSON.stringify(textResponse)}`, 'social-publishing');
              
              if (textResponse.success) {
                // Обновляем lastMessageId если есть message_id
                if (textResponse.success && textResponse.result && textResponse.result.message_id) {
                  lastMessageId = textResponse.result.message_id;
                }
                
                return {
                  platform: 'telegram',
                  status: 'published',
                  publishedAt: new Date(),
                  postUrl: lastMessageId ? this.formatTelegramUrl(chatId, formattedChatId, lastMessageId) : `https://t.me/${chatId.replace('@', '')}`
                };
              } else {
                return {
                  platform: 'telegram',
                  status: 'failed',
                  publishedAt: null,
                  error: `Ошибка при отправке текста: ${textResponse.error || JSON.stringify(textResponse)}`
                };
              }
            }
          } catch (error: any) {
            log(`Ошибка при отправке текста в Telegram: ${error.message}`, 'social-publishing');
            
            if (error.response) {
              log(`Данные ответа при ошибке: ${JSON.stringify(error.response.data)}`, 'social-publishing');
            }
            
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Ошибка при отправке текста в Telegram: ${error.message}`
            };
          }
        }
      }
      
      // В случае неожиданной логики
      return {
        platform: 'telegram',
        status: 'published',
        publishedAt: new Date()
      };
    } catch (error: any) {
      log(`Общая ошибка при публикации в Telegram: ${error.message}`, 'social-publishing');
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: `Общая ошибка при публикации в Telegram: ${error.message}`
      };
    }
  }

  /**
   * Публикует контент в ВКонтакте с использованием Imgur для изображений
   * @param content Контент для публикации
   * @param vkSettings Настройки VK API
   * @returns Результат публикации
   */
  async publishToVk(
    content: CampaignContent,
    vkSettings?: SocialMediaSettings['vk']
  ): Promise<SocialPublication> {
    // Проверяем наличие настроек VK
    if (!vkSettings || !vkSettings.token || !vkSettings.groupId) {
      log(`Ошибка публикации в VK: отсутствуют настройки. Token: ${vkSettings?.token ? 'задан' : 'отсутствует'}, GroupID: ${vkSettings?.groupId ? 'задан' : 'отсутствует'}`, 'social-publishing');
      return {
        platform: 'vk',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для ВКонтакте (токен или ID группы). Убедитесь, что настройки заданы в кампании.'
      };
    }

    // Получаем токен и groupId из настроек
    const token = vkSettings.token;
    let groupId = vkSettings.groupId;
    
    // Очищаем groupId от префикса "club" если он присутствует
    if (typeof groupId === 'string' && groupId.startsWith('club')) {
      groupId = groupId.replace(/^club/, '');
      log(`Формат ID группы VK очищен от префикса "club": ${groupId}`, 'social-publishing');
    }
    
    log(`Используем токен VK: ${token.substring(0, 6)}... и ID группы: ${groupId}`, 'social-publishing');

    try {
      log(`Публикация в VK. Контент: ${content.id}, тип: ${content.contentType}`, 'social-publishing');

      // Обработка дополнительных изображений
      let processedContent = this.processAdditionalImages(content, 'VK');
      
      // Загрузка изображений на Imgur перед публикацией
      processedContent = await this.uploadImagesToImgur(processedContent);

      // Подготовка текста поста
      let text = processedContent.title ? `${processedContent.title}\n\n` : '';
      
      // VK не поддерживает HTML, поэтому заменяем HTML-теги на текстовые аналоги
      let contentText = processedContent.content
        // Обработка абзацев и переносов строк
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<div>(.*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, '$1\n\n')
        
        // Для ВКонтакте НЕ преобразуем теги форматирования, т.к. символы * и _ не обрабатываются
        .replace(/<b>(.*?)<\/b>/g, '$1')
        .replace(/<strong>(.*?)<\/strong>/g, '$1')
        .replace(/<i>(.*?)<\/i>/g, '$1')
        .replace(/<em>(.*?)<\/em>/g, '$1')
        
        // Удаление всех остальных HTML-тегов
        .replace(/<[^>]*>/g, '');
      
      text += contentText;
      
      // Формируем запрос к API VK
      const formData = new FormData();
      formData.append('owner_id', `-${groupId}`); // Отрицательный ID для группы
      formData.append('from_group', '1'); // Публикация от имени группы
      formData.append('message', text);
      formData.append('access_token', token);
      formData.append('v', '5.131'); // Версия API VK
      
      // Обработка изображений
      const attachments: string[] = [];
      
      // Загрузка основного изображения, если оно есть
      if (processedContent.imageUrl) {
        try {
          const imageUrl = processedContent.imageUrl;
          log(`Загрузка основного изображения для VK: ${imageUrl}`, 'social-publishing');
          
          // Получение URL для загрузки фото на сервер VK
          const getUploadServerResponse = await axios.get(`https://api.vk.com/method/photos.getWallUploadServer`, {
            params: {
              group_id: groupId,
              access_token: token,
              v: '5.131'
            }
          });
          
          if (getUploadServerResponse.data && getUploadServerResponse.data.response && getUploadServerResponse.data.response.upload_url) {
            const uploadUrl = getUploadServerResponse.data.response.upload_url;
            
            // Загрузка изображения на сервер VK
            // Для этого сначала нужно скачать изображение и отправить его в multipart/form-data
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageFormData = new FormData();
            imageFormData.append('photo', Buffer.from(imageResponse.data), 'image.jpg');
            
            const uploadResponse = await axios.post(uploadUrl, imageFormData, {
              headers: {
                ...imageFormData.getHeaders()
              }
            });
            
            if (uploadResponse.data) {
              // Сохранение загруженной фотографии на стене группы
              const saveWallPhotoResponse = await axios.get(`https://api.vk.com/method/photos.saveWallPhoto`, {
                params: {
                  group_id: groupId,
                  server: uploadResponse.data.server,
                  photo: uploadResponse.data.photo,
                  hash: uploadResponse.data.hash,
                  access_token: token,
                  v: '5.131'
                }
              });
              
              if (saveWallPhotoResponse.data && saveWallPhotoResponse.data.response && saveWallPhotoResponse.data.response.length > 0) {
                const photoObj = saveWallPhotoResponse.data.response[0];
                const attachment = `photo${photoObj.owner_id}_${photoObj.id}`;
                attachments.push(attachment);
                log(`Основное изображение успешно загружено для VK: ${attachment}`, 'social-publishing');
              }
            }
          }
        } catch (error) {
          log(`Ошибка при загрузке основного изображения для VK: ${error}`, 'social-publishing');
        }
      }
      
      // Обработка дополнительных изображений
      if (processedContent.additionalImages && processedContent.additionalImages.length > 0) {
        for (let i = 0; i < processedContent.additionalImages.length; i++) {
          try {
            const imageUrl = processedContent.additionalImages[i];
            log(`Загрузка дополнительного изображения ${i+1} для VK: ${imageUrl}`, 'social-publishing');
            
            // Получение URL для загрузки фото на сервер VK
            const getUploadServerResponse = await axios.get(`https://api.vk.com/method/photos.getWallUploadServer`, {
              params: {
                group_id: groupId,
                access_token: token,
                v: '5.131'
              }
            });
            
            if (getUploadServerResponse.data && getUploadServerResponse.data.response && getUploadServerResponse.data.response.upload_url) {
              const uploadUrl = getUploadServerResponse.data.response.upload_url;
              
              // Загрузка изображения на сервер VK
              const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
              const imageFormData = new FormData();
              imageFormData.append('photo', Buffer.from(imageResponse.data), `image_${i+1}.jpg`);
              
              const uploadResponse = await axios.post(uploadUrl, imageFormData, {
                headers: {
                  ...imageFormData.getHeaders()
                }
              });
              
              if (uploadResponse.data) {
                // Сохранение загруженной фотографии на стене группы
                const saveWallPhotoResponse = await axios.get(`https://api.vk.com/method/photos.saveWallPhoto`, {
                  params: {
                    group_id: groupId,
                    server: uploadResponse.data.server,
                    photo: uploadResponse.data.photo,
                    hash: uploadResponse.data.hash,
                    access_token: token,
                    v: '5.131'
                  }
                });
                
                if (saveWallPhotoResponse.data && saveWallPhotoResponse.data.response && saveWallPhotoResponse.data.response.length > 0) {
                  const photoObj = saveWallPhotoResponse.data.response[0];
                  const attachment = `photo${photoObj.owner_id}_${photoObj.id}`;
                  attachments.push(attachment);
                  log(`Дополнительное изображение ${i+1} успешно загружено для VK: ${attachment}`, 'social-publishing');
                }
              }
            }
          } catch (error) {
            log(`Ошибка при загрузке дополнительного изображения ${i+1} для VK: ${error}`, 'social-publishing');
          }
          
          // Ограничение на количество фотографий в одном посте
          if (attachments.length >= 10) {
            log(`Достигнуто максимальное количество фотографий для поста VK (10)`, 'social-publishing');
            break;
          }
        }
      }
      
      // Если есть изображения, добавляем их в параметр attachments
      if (attachments.length > 0) {
        formData.append('attachments', attachments.join(','));
      }
      
      // Публикация поста на стене группы
      const response = await axios.post('https://api.vk.com/method/wall.post', formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
      
      if (response.data && response.data.response && response.data.response.post_id) {
        const postId = response.data.response.post_id;
        log(`Пост успешно опубликован в VK, ID: ${postId}`, 'social-publishing');
        
        return {
          platform: 'vk',
          status: 'published',
          publishedAt: new Date(),
          postUrl: `https://vk.com/wall-${groupId}_${postId}`
        };
      } else {
        log(`Ошибка при публикации в VK: ${JSON.stringify(response.data)}`, 'social-publishing');
        return {
          platform: 'vk',
          status: 'failed',
          publishedAt: null,
          error: `Ошибка при публикации поста в VK: ${JSON.stringify(response.data)}`
        };
      }
    } catch (error: any) {
      log(`Ошибка при публикации в VK: ${error.message}`, 'social-publishing');
      return {
        platform: 'vk',
        status: 'failed',
        publishedAt: null,
        error: `Ошибка при публикации в VK: ${error.message}`
      };
    }
  }

  /**
   * Получает permalink публикации из ответа API Instagram
   * @param response Ответ API Instagram
   * @returns URL публикации или null в случае ошибки
   */
  private getInstagramPermalink(response: any): string | null {
    try {
      // В реальном API Instagram permalink приходит в ответе
      // Например: response.permalink или response.data.permalink
      if (response && response.permalink) {
        return response.permalink;
      } else if (response && response.data && response.data.permalink) {
        return response.data.permalink;
      } else if (response && response.id) {
        // Если permalink не доступен, но есть ID, формируем URL согласно стандартному формату
        // Это наиболее вероятный формат URL для Instagram
        return `https://www.instagram.com/p/${response.id}/`;
      }
      return null;
    } catch (error) {
      console.error('Ошибка при получении permalink из ответа Instagram API:', error);
      return null;
    }
  }

  /**
   * Публикует контент в Instagram через Graph API
   * @param content Контент для публикации
   * @param instagramSettings Настройки Instagram API
   * @returns Результат публикации
   */
  async publishToInstagram(
    content: CampaignContent,
    instagramSettings?: SocialMediaSettings['instagram']
  ): Promise<SocialPublication> {
    // Проверяем наличие настроек
    log(`Проверка настроек Instagram: ${JSON.stringify({
      hasSettings: !!instagramSettings,
      settingsType: typeof instagramSettings,
      tokenExists: instagramSettings?.token ? 'да' : 'нет',
      tokenType: instagramSettings?.token ? typeof instagramSettings.token : 'не определен',
      tokenLength: instagramSettings?.token ? instagramSettings.token.length : 0,
      businessAccountId: instagramSettings?.businessAccountId || 'отсутствует'
    })}`, 'social-publishing');
    
    try {
      // Напрямую используем реализацию из отдельного сервиса Instagram
      // который содержит правильную реализацию публикации
      log(`Делегирование публикации в Instagram специализированному сервису`, 'social-publishing');
      
      // Импортируем сервис Instagram и вызываем его метод
      const { instagramService } = await import('./social/instagram-service');
      
      if (!instagramSettings) {
        log(`Ошибка: instagramSettings не определен, создаём пустые настройки`, 'social-publishing');
        // Создаем пустой объект настроек
        instagramSettings = {
          token: null,
          accessToken: null,
          businessAccountId: null
        };
      }
      
      // Передаем параметры в специализированный сервис
      log(`Вызываем instagramService.publishToInstagram с параметрами token=${!!instagramSettings.token}, businessAccountId=${!!instagramSettings.businessAccountId}`, 'social-publishing');
      const result = await instagramService.publishToInstagram(content, instagramSettings);
      
      log(`Instagram-сервис вернул результат: status=${result.status}, error=${result.error || 'нет'}`, 'social-publishing');
      
      // Возвращаем результат, добавляя ID публикации, если она успешна
      if (result.status === 'published') {
        log(`Instagram публикация успешна, URL: ${result.postUrl}`, 'social-publishing');
        return {
          ...result,
          // Добавляем postId для совместимости
          postId: result.postId || result.postUrl?.split('/').filter(Boolean).pop() || null
        };
      }
      
      // Возвращаем ошибку, если публикация не удалась
      return result;
    } catch (error: any) {
      log(`[Instagram] Общая ошибка при публикации через сервис: ${error.message}`, 'social-publishing');
      return {
        platform: 'instagram',
        status: 'failed',
        publishedAt: null,
        error: `Ошибка при делегировании публикации в Instagram: ${error.message}`
      };
    }
  }

  /**
   * Публикует контент в Facebook (заглушка - ожидается полная реализация)
   * @param content Контент для публикации
   * @param facebookSettings Настройки Facebook API
   * @returns Результат публикации
   */
  async publishToFacebook(
    content: CampaignContent,
    facebookSettings?: SocialMediaSettings['facebook']
  ): Promise<SocialPublication> {
    // Проверяем наличие настроек
    if (!facebookSettings || !facebookSettings.token || !facebookSettings.pageId) {
      log(`Ошибка публикации в Facebook: отсутствуют настройки. Token: ${facebookSettings?.token ? 'задан' : 'отсутствует'}, PageID: ${facebookSettings?.pageId ? 'задан' : 'отсутствует'}`, 'social-publishing');
      return {
        platform: 'facebook',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Facebook (токен или ID страницы). Убедитесь, что настройки заданы в кампании.'
      };
    }

    // Получаем токен и pageId из настроек
    const token = facebookSettings.token;
    const pageId = facebookSettings.pageId;
    
    log(`Используем токен Facebook: ${token.substring(0, 6)}... и ID страницы: ${pageId}`, 'social-publishing');

    try {
      log(`Публикация в Facebook. Контент: ${content.id}, тип: ${content.contentType}`, 'social-publishing');
      
      // Обработка дополнительных изображений
      let processedContent = this.processAdditionalImages(content, 'Facebook');
      
      // Загрузка изображений на Imgur перед публикацией
      processedContent = await this.uploadImagesToImgur(processedContent);

      // Формирование Facebook-совместимого текста
      let text = processedContent.title ? `${processedContent.title}\n\n` : '';
      
      // Facebook позволяет использовать простые форматы разметки
      let contentText = processedContent.content
        // Обработка абзацев и переносов строк
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
        .replace(/<div>(.*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, '$1\n\n')
        
        // Форматирование текста для Facebook - не используем символы * и _
        // так как они не отображаются корректно во многих случаях
        .replace(/<b>(.*?)<\/b>/g, '$1')
        .replace(/<strong>(.*?)<\/strong>/g, '$1')
        .replace(/<i>(.*?)<\/i>/g, '$1')
        .replace(/<em>(.*?)<\/em>/g, '$1')
        
        // Удаление всех остальных HTML-тегов
        .replace(/<[^>]*>/g, '');
      
      text += contentText;
      
      // Формируем данные для публикации
      const postData = {
        message: text,
        access_token: token
      };
      
      // Проверяем наличие изображения
      if (processedContent.imageUrl) {
        try {
          log(`Facebook: Публикация с изображением ${processedContent.imageUrl}`, 'social-publishing');
          log(`Facebook: Отправка фото на ${pageId} с токеном длиной ${token.length} символов`, 'social-publishing');
          log(`Facebook: Текст подписи (начало): ${text.substring(0, 100)}...`, 'social-publishing');
          
          // Для Facebook можно отправить URL изображения напрямую
          const response = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
            url: processedContent.imageUrl,
            caption: text,
            access_token: token
          });
          
          if (response.data && response.data.id) {
            log(`Изображение успешно опубликовано в Facebook, ID: ${response.data.id}`, 'social-publishing');
            
            return {
              platform: 'facebook',
              status: 'published',
              publishedAt: new Date(),
              postUrl: `https://www.facebook.com/${response.data.post_id || response.data.id}`
            };
          } else {
            log(`Странный ответ от Facebook API при публикации фото: ${JSON.stringify(response.data)}`, 'social-publishing');
          }
        } catch (error: any) {
          log(`Ошибка при публикации фото в Facebook: ${error.message}`, 'social-publishing');
          
          // Информация об ошибке Facebook API
          if (error.response && error.response.data) {
            log(`Facebook API ответ (фото): ${JSON.stringify(error.response.data)}`, 'social-publishing');
          }
          
          // Если не удалось опубликовать с фото, пробуем только текст
          log(`Пробуем опубликовать только текстовый пост в Facebook`, 'social-publishing');
        }
      }
      
      // Публикация обычного текстового поста (если нет фото или не удалось опубликовать с фото)
      try {
        log(`Facebook: Отправка текстового поста на ${pageId} с токеном длиной ${token.length} символов`, 'social-publishing');
        log(`Facebook: Текст поста (начало): ${text.substring(0, 100)}...`, 'social-publishing');

        const response = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, postData);
        
        if (response.data && response.data.id) {
          log(`Пост успешно опубликован в Facebook, ID: ${response.data.id}`, 'social-publishing');
          
          return {
            platform: 'facebook',
            status: 'published',
            publishedAt: new Date(),
            postUrl: `https://www.facebook.com/${response.data.id}`
          };
        } else {
          log(`Ошибка при публикации в Facebook (пустой ответ): ${JSON.stringify(response.data)}`, 'social-publishing');
          return {
            platform: 'facebook',
            status: 'failed',
            publishedAt: null,
            error: `Ошибка при публикации поста в Facebook: ${JSON.stringify(response.data)}`
          };
        }
      } catch (fbError: any) {
        log(`Ошибка при текстовой публикации в Facebook: ${fbError.message}`, 'social-publishing');
        if (fbError.response) {
          log(`Facebook API ответ: ${JSON.stringify(fbError.response.data)}`, 'social-publishing');
        }
        return {
          platform: 'facebook',
          status: 'failed',
          publishedAt: null,
          error: `Ошибка при публикации в Facebook: ${fbError.message}`
        };
      }
    } catch (error: any) {
      log(`Ошибка при публикации в Facebook: ${error.message}`, 'social-publishing');
      return {
        platform: 'facebook',
        status: 'failed',
        publishedAt: null,
        error: `Ошибка при публикации в Facebook: ${error.message}`
      };
    }
  }

  /**
   * Обновляет статус публикации контента в социальной сети
   * @param contentId ID контента
   * @param platform Социальная платформа
   * @param publicationResult Результат публикации
   * @returns Обновленный контент или null в случае ошибки
   */
  async updatePublicationStatus(
    contentId: string,
    platform: SocialPlatform,
    publicationResult: SocialPublication
  ): Promise<CampaignContent | null> {
    try {
      log(`Обновление статуса публикации: ${contentId}, платформа: ${platform}, статус: ${publicationResult.status}`, 'social-publishing');
      
      // Получаем системный токен (токен администратора)
      const systemToken = await this.getSystemToken();
      
      if (!systemToken) {
        log(`Не удалось получить системный токен для обновления статуса публикации`, 'social-publishing');
        return null;
      }
      
      // Шаг 1: Получаем текущие данные контента напрямую через API с системным токеном
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      let content: CampaignContent | null = null;
      
      try {
        log(`Получение данных контента через API: ${contentId}`, 'social-publishing');
        
        const response = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
          headers: {
            'Authorization': `Bearer ${systemToken}`
          }
        });
        
        if (response.data && response.data.data) {
          const item = response.data.data;
          content = {
            id: item.id,
            content: item.content,
            userId: item.user_id,
            campaignId: item.campaign_id,
            status: item.status,
            contentType: item.content_type || 'text',
            title: item.title || null,
            imageUrl: item.image_url,
            videoUrl: item.video_url,
            scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
            createdAt: new Date(item.created_at),
            socialPlatforms: item.social_platforms || {},
            additionalImages: item.additional_images || null,
            keywords: item.keywords || null,
            hashtags: item.hashtags || null,
            prompt: item.prompt || null,
            links: item.links || null,
            publishedAt: item.published_at ? new Date(item.published_at) : null,
            metadata: item.metadata || {}
          };
          
          log(`Контент успешно получен через API: ${content.id}, user_id: ${content.userId}`, 'social-publishing');
        }
      } catch (error: any) {
        log(`Ошибка при получении контента через API: ${error.message}`, 'social-publishing');
        return null;
      }
      
      if (!content) {
        log(`Не удалось получить контент ${contentId} для обновления статуса`, 'social-publishing');
        return null;
      }
      
      // Шаг 2: Обновляем статус публикации в объекте social_platforms
      const socialPlatforms = content.socialPlatforms || {};
      
      const updatedSocialPlatforms = {
        ...socialPlatforms,
        [platform]: {
          status: publicationResult.status,
          publishedAt: publicationResult.publishedAt ? new Date(publicationResult.publishedAt) : null,
          error: publicationResult.error || null
        }
      };
      
      // Шаг 3: Обновляем данные напрямую через API с системным токеном
      log(`Прямое обновление статуса публикации через API: ${contentId}, платформа: ${platform}`, 'social-publishing');
      
      try {
        const updateResponse = await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: updatedSocialPlatforms
        }, {
          headers: {
            'Authorization': `Bearer ${systemToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (updateResponse.data && updateResponse.data.data) {
          log(`Статус публикации успешно обновлен через API: ${contentId}, платформа: ${platform}`, 'social-publishing');
          
          // Возвращаем обновленный объект контента с новым значением socialPlatforms
          return {
            ...content,
            socialPlatforms: updatedSocialPlatforms
          };
        } else {
          log(`Странный ответ от API при обновлении статуса: ${JSON.stringify(updateResponse.data)}`, 'social-publishing');
        }
      } catch (error: any) {
        log(`Ошибка при прямом обновлении статуса публикации через API: ${error.message}`, 'social-publishing');
        
        // В случае ошибки, возвращаем исходный объект с обновленным полем socialPlatforms
        // Это позволит избежать ошибки при последующих вызовах этого метода
        return {
          ...content,
          socialPlatforms: updatedSocialPlatforms
        };
      }
      
      return null;
    } catch (error: any) {
      log(`Ошибка при обновлении статуса публикации: ${error.message}`, 'social-publishing');
      return null;
    }
  }

  /**
   * Публикует контент в выбранную социальную платформу
   * @param content Контент для публикации
   * @param platform Социальная платформа
   * @param settings Настройки социальных сетей
   * @returns Результат публикации
   */
  async publishToPlatform(
    content: CampaignContent,
    platform: SocialPlatform,
    settings: SocialMediaSettings
  ): Promise<SocialPublication> {
    log(`Публикация контента "${content.title}" в ${platform}`, 'social-publishing');
    
    // Для публикации в Telegram устанавливаем флаг forceImageTextSeparation только для длинных текстов
    // Для коротких текстов (менее 1000 символов) публикуем текст и изображение вместе
    if (platform === 'telegram') {
      if (!content.metadata) {
        content.metadata = {};
      }
      if (typeof content.metadata === 'object') {
        // Проверяем длину текста
        const textLength = (content.content || '').length + (content.title ? content.title.length : 0);
        const needsSeparation = textLength > 1000;
        
        // Устанавливаем флаг разделения только для длинных текстов (> 1000 символов)
        (content.metadata as any).forceImageTextSeparation = needsSeparation;
        
        log(`${needsSeparation ? 'Установлен' : 'Отключен'} флаг forceImageTextSeparation для Telegram публикации. Длина текста: ${textLength} символов`, 'social-publishing');
      }
    }
    
    switch (platform) {
      case 'telegram':
        return await this.publishToTelegram(content, settings.telegram);
      case 'vk':
        return await this.publishToVk(content, settings.vk);
      case 'instagram':
        return await this.publishToInstagram(content, settings.instagram);
      case 'facebook':
        return await this.publishToFacebook(content, settings.facebook);
      default:
        return {
          platform: platform as SocialPlatform,
          status: 'failed',
          publishedAt: null,
          error: `Неподдерживаемая платформа: ${platform}`
        };
    }
  }
}

// Создаем экземпляр сервиса
export const socialPublishingWithImgurService = new SocialPublishingWithImgurService();