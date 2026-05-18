import axios from 'axios';
import { log } from '../../utils/logger';
import { CampaignContent, SocialMediaSettings, SocialPlatform, SocialPublication } from '@shared/schema';
import { BaseSocialService } from './base-service';
import { TelegramS3Integration } from './telegram-s3-integration';
import { markdownToTelegramHtml } from '../../utils/strip-markdown';

/**
 * Сервис для публикации контента в Telegram
 */
export class TelegramService extends BaseSocialService {
  // Храним username канала, полученный в процессе публикации
  private currentChatUsername?: string;
  
  // Интеграция с Beget S3 для работы с видео
  private telegramS3Integration: TelegramS3Integration;
  
  /**
   * Конструктор сервиса Telegram
   */
  constructor() {
    super();
    this.telegramS3Integration = new TelegramS3Integration();
  }
  /**
   * Форматирует текст для публикации в Telegram с учетом поддерживаемых HTML-тегов
   * @param content Исходный текст контента
   * @returns Отформатированный текст для Telegram с поддержкой HTML
   */
  public formatTextForTelegram(content: string): string {
    // Логируем начало обработки
    log(`Начало форматирования текста для Telegram, размер: ${content?.length || 0} символов`, 'social-publishing');
    if (!content || typeof content !== 'string') {
      return '';
    }
    
    // Сохраняем исходный текст для логирования
    const originalLength = content.length;
    
    try {
      // Telegram поддерживает только ограниченный набор HTML-тегов:
      // <b>, <strong>, <i>, <em>, <u>, <s>, <strike>, <code>, <pre>, <a href="...">
      
      log(`Форматирование текста для Telegram, исходная длина: ${originalLength} символов`, 'social-publishing');

      // Конвертируем Markdown в HTML ПЕРВЫМ делом, до любой другой обработки
      let cleanedContent = markdownToTelegramHtml(content);

      // Начинаем обработку HTML
      let formattedText = cleanedContent;
        
      // Обработка многострочных блочных элементов
      formattedText = formattedText
        // Преобразуем разрывы строк
        .replace(/<br\s*\/?>/gi, '\n')
        // Двойной проход с использованием выражений для поддержки многострочных тегов
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
        .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n')
        .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n')
        
        // Преобразуем все остальные блочные элементы, которые не поддерживаются Telegram
        .replace(/<(?:article|section|aside|header|footer|nav|main)[^>]*>([\s\S]*?)<\/(?:article|section|aside|header|footer|nav|main)>/gi, '$1\n')
        
        // Обработка списков
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n')
        .replace(/<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/gi, '$1\n')
        
        // Обработка таблиц
        .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '$1\n')
        .replace(/<(?:table|thead|tbody|tfoot)[^>]*>([\s\S]*?)<\/(?:table|thead|tbody|tfoot)>/gi, '$1\n\n')
        
        // Приводим HTML-теги к поддерживаемым в Telegram форматам
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>')
        .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '<b>$1</b>')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>')
        .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '<i>$1</i>')
        .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '<u>$1</u>')
        .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '<u>$1</u>')
        .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '<s>$1</s>')
        .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '<s>$1</s>')
        .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '<s>$1</s>')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '<code>$1</code>')
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '<pre>$1</pre>')
        
        // Обрабатываем ссылки по формату Telegram
        .replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '<a href="$1">$2</a>');
      
      // Убираем лишние переносы строк (более 2 подряд)
      formattedText = formattedText.replace(/\n{3,}/g, '\n\n');
      
      // Сохраняем поддерживаемые HTML-теги и удаляем только неподдерживаемые
      formattedText = formattedText.replace(/<(?!\/?(?:b|i|u|s|code|pre|a\b)[^>]*>)[^>]+>/gi, '');
      
      // Удаление невидимых символов (сохраняем для совместимости)
      formattedText = formattedText
        .replace(/\u200B/g, '') // Zero-width space
        .replace(/\u200C/g, '') // Zero-width non-joiner
        .replace(/\u200D/g, '') // Zero-width joiner
        .replace(/\uFEFF/g, ''); // Zero-width no-break space
      
      // Проверка на длинные слова
      const longWordsFound = formattedText.match(/[^\s]{100,}/g);
      if (longWordsFound && longWordsFound.length > 0) {
        log(`Предупреждение: найдены очень длинные слова (>100 символов), которые могут вызвать проблемы в Telegram: ${longWordsFound.length} шт.`, 'social-publishing');
      }
      
      // Обрезаем текст до 4096 символов (максимальное количество для Telegram)
      if (formattedText.length > 4096) {
        formattedText = formattedText.substring(0, 4093) + '...';
        log(`Предупреждение: текст для Telegram был обрезан до 4096 символов (исходный: ${originalLength})`, 'social-publishing');
      }
      
      // Отладочный вывод образцов отформатированного текста
      if (formattedText.length > 0) {
        log(`Отформатированный текст для Telegram (${formattedText.length} символов) начинается с: ${formattedText.substring(0, Math.min(100, formattedText.length))}...`, 'social-publishing');
      }
      
      return formattedText;
      
    } catch (error) {
      log(`Ошибка при форматировании текста для Telegram: ${error}`, 'social-publishing');
      // В случае ошибки возвращаем обычный текст без форматирования
      if (content.length > 4096) {
        return content.substring(0, 4093) + '...';
      }
      return content;
    }
  }
  
  /**
   * Проверяет, является ли HTML-код валидным для Telegram
   * @param text Текст с HTML-разметкой
   * @returns true, если HTML валиден для Telegram
   */
  public isValidHtmlForTelegram(text: string): boolean {
    // Если текст не содержит HTML, считаем его валидным
    if (!text.includes('<') || !text.includes('>')) {
      return true;
    }
    
    // Проверяем количество открывающих и закрывающих тегов
    const openTagRegex = /<(b|strong|i|em|u|ins|s|strike|del|code|pre|a)(?:\s+[^>]*)?>/gi;
    const closeTagRegex = /<\/(b|strong|i|em|u|ins|s|strike|del|code|pre|a)>/gi;
    
    const openMatches = text.match(openTagRegex) || [];
    const closeMatches = text.match(closeTagRegex) || [];
    
    // Если количество не совпадает, значит есть незакрытые теги
    if (openMatches.length !== closeMatches.length) {
      log(`HTML не валиден для Telegram: открывающих тегов ${openMatches.length}, закрывающих ${closeMatches.length}`, 'social-publishing');
      return false;
    }
    
    // Проверяем наличие неподдерживаемых тегов
    const unsupportedTagRegex = /<(?!\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|a))[a-z][^>]*>/gi;
    const unsupportedMatches = text.match(unsupportedTagRegex) || [];
    
    if (unsupportedMatches.length > 0) {
      log(`HTML содержит неподдерживаемые Telegram теги: ${unsupportedMatches.slice(0, 5).join(', ')}${unsupportedMatches.length > 5 ? '...' : ''}`, 'social-publishing');
      return false;
    }
    
    // Базовая проверка на корректное вложение тегов (в идеале нужен полноценный парсер)
    // Но для простых случаев это может быть достаточно
    return true;
  }
  
  /**
   * Исправляет незакрытые HTML-теги в тексте
   * @param text Текст с HTML-разметкой
   * @returns Текст с исправленными незакрытыми тегами
   */
  public fixUnclosedTags(text: string): string {
    // Расширенный список поддерживаемых Telegram тегов и их синонимов
    const tagMapping: { [key: string]: string } = {
      'b': 'b', 'strong': 'b',
      'i': 'i', 'em': 'i',
      'u': 'u', 'ins': 'u',
      's': 's', 'strike': 's', 'del': 's',
      'code': 'code', 'pre': 'pre', 'a': 'a'
    };
    
    // Список поддерживаемых тегов для проверки
    const supportedTags = Object.keys(tagMapping);
    
    // Подсчитываем количество открывающих и закрывающих тегов
    const openTagRegex = /<(b|strong|i|em|u|ins|s|strike|del|code|pre|a)(?:\s+[^>]*)?>/gi;
    const closeTagRegex = /<\/(b|strong|i|em|u|ins|s|strike|del|code|pre|a)>/gi;
    
    const openMatches = text.match(openTagRegex) || [];
    const closeMatches = text.match(closeTagRegex) || [];
    
    // Проверяем несоответствие в количестве тегов
    if (openMatches.length !== closeMatches.length) {
      log(`Внимание: количество открывающих (${openMatches.length}) и закрывающих (${closeMatches.length}) HTML-тегов не совпадает. Это может вызвать ошибку при отправке в Telegram.`, 'social-publishing');
    }
    
    // Преобразуем текст с помощью DOMParser для правильной обработки тегов
    // Но так как это серверный JS, используем регулярные выражения
    
    // Создаем стек для отслеживания открытых тегов
    const stack: string[] = [];
    
    // Регулярное выражение для поиска всех HTML-тегов, включая атрибуты
    const tagRegex = /<\/?([a-z]+)(?:\s+[^>]*)?>/gi;
    let match;
    let processedText = text;
    let lastIndex = 0;
    
    // Временная строка для построения обработанного текста
    let resultText = '';
    
    // Выполняем проход по всем тегам в тексте
    while ((match = tagRegex.exec(text)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      const mappedTag = tagMapping[tagName];
      
      // Проверяем, является ли тег поддерживаемым
      if (!supportedTags.includes(tagName)) {
        continue; // Пропускаем неподдерживаемые теги
      }
      
      // Получаем текст до текущего тега
      const textBeforeTag = text.substring(lastIndex, match.index);
      resultText += textBeforeTag;
      
      const isClosing = fullTag.startsWith('</');
      
      if (isClosing) {
        // Если это закрывающий тег
        if (stack.length > 0) {
          // Проверяем, соответствует ли он последнему открытому или его синониму
          const lastOpenTag = stack[stack.length - 1];
          const lastOpenMapped = tagMapping[lastOpenTag];
          const currentMapped = tagMapping[tagName];
          
          if (lastOpenMapped === currentMapped) {
            // Правильное закрытие, добавляем тег в стандартизированной форме
            resultText += `</${currentMapped}>`;
            stack.pop();
          } else {
            // Неправильный порядок закрытия, закрываем текущий тег так, как он был открыт
            resultText += `</${currentMapped}>`;
            // Находим и удаляем соответствующий тег из стека
            const indexInStack = stack.findIndex(t => tagMapping[t] === currentMapped);
            if (indexInStack >= 0) {
              stack.splice(indexInStack, 1);
            }
          }
        } else {
          // Закрывающий тег без открывающего - пропускаем его
          log(`Обнаружен закрывающий тег </${tagName}> без соответствующего открывающего`, 'social-publishing');
        }
      } else {
        // Это открывающий тег, добавляем его в стек и в результат
        // Преобразуем теги к стандартной форме для Telegram
        if (tagName === 'a') {
          // Для тегов ссылок сохраняем href
          const hrefMatch = fullTag.match(/href=["']([^"']*)["']/i);
          const href = hrefMatch ? hrefMatch[1] : '';
          resultText += `<a href="${href}">`;
        } else {
          // Для других тегов используем стандартную форму
          resultText += `<${tagMapping[tagName]}>`;
        }
        stack.push(tagName);
      }
      
      lastIndex = match.index + fullTag.length;
    }
    
    // Добавляем оставшийся текст после последнего тега
    resultText += text.substring(lastIndex);
    
    // Закрываем все оставшиеся открытые теги в обратном порядке
    if (stack.length > 0) {
      log(`Обнаружены незакрытые HTML теги: ${stack.join(', ')}. Автоматически закрываем их.`, 'social-publishing');
      
      // Закрываем теги в обратном порядке (LIFO)
      for (let i = stack.length - 1; i >= 0; i--) {
        const mappedTag = tagMapping[stack[i]];
        resultText += `</${mappedTag}>`;
      }
    }
    
    if (resultText !== text) {
      log(`Исправлены незакрытые HTML-теги. Фрагмент исправленного текста: ${resultText.substring(0, Math.min(100, resultText.length))}...`, 'social-publishing');
    }
    
    return resultText;
  }

  /**
   * Подготавливает текст для отправки в Telegram: форматирует и обрезает при необходимости
   * @param content Исходный текст контента
   * @param maxLength Максимальная длина текста (по умолчанию 4000 для защиты от превышения лимита в 4096)
   * @returns Отформатированный и обрезанный текст для Telegram
   */
  private prepareTelegramText(content: string, maxLength: number = 4000): string {
    try {
      // Применяем HTML-форматирование для Telegram
      let formattedText = this.formatTextForTelegram(content);
      
      // Дополнительно применяем агрессивный исправитель тегов для гарантированного закрытия всех тегов
      formattedText = this.aggressiveTagFixer(formattedText);
      log(`Telegram текст после агрессивного исправления тегов: ${formattedText.substring(0, Math.min(100, formattedText.length))}...`, 'social-publishing');
      
      // Подсчитываем открывающие/закрывающие теги для диагностики
      const openingTags = (formattedText.match(/<[a-z][^>]*>/gi) || []).length;
      const closingTags = (formattedText.match(/<\/[a-z][^>]*>/gi) || []).length;
      log(`Теги в тексте после обработки: открывающих ${openingTags}, закрывающих ${closingTags}`, 'social-publishing');
      
      if (openingTags !== closingTags) {
        log(`Внимание: количество открывающих (${openingTags}) и закрывающих (${closingTags}) HTML-тегов не совпадает. Это может вызвать ошибку при отправке в Telegram.`, 'social-publishing');
      }
      
      // Проверка длины и обрезка
      if (formattedText.length > maxLength) {
        log(`Текст для Telegram превышает ${maxLength} символов, обрезаем...`, 'social-publishing');
        
        // Находим ближайший конец предложения для более аккуратной обрезки
        const sentenceEndPos = formattedText.substring(0, maxLength - 3).lastIndexOf('.');
        const paragraphEndPos = formattedText.substring(0, maxLength - 3).lastIndexOf('\n');
        
        const cutPosition = Math.max(
          sentenceEndPos > maxLength - 200 ? sentenceEndPos + 1 : 0, 
          paragraphEndPos > maxLength - 200 ? paragraphEndPos + 1 : 0,
          maxLength - 3
        );
        
        formattedText = formattedText.substring(0, cutPosition) + '...';
        log(`Текст обрезан до ${formattedText.length} символов`, 'social-publishing');
      }
      
      return formattedText;
    } catch (error) {
      log(`Ошибка при подготовке текста для Telegram: ${error}`, 'social-publishing');
      
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
  private async sendTextMessageToTelegram(text: string, chatId: string, token: string): Promise<{ success: boolean, result?: any, error?: string, messageId?: number | string }> {
    try {
      // Дополнительно проверяем длину текста
      if (!text || text.trim() === '') {
        log(`Пустой текст для отправки в Telegram`, 'social-publishing');
        return { success: false, error: 'Empty text' };
      }
      
      // Сначала форматируем текст для Telegram включая обработку HTML тегов
      let formattedText = this.formatTextForTelegram(text);
      
      // Дополнительно применяем агрессивный исправитель тегов
      // для гарантированного закрытия всех тегов
      formattedText = this.aggressiveTagFixer(formattedText);
      log(`Текст после агрессивного исправления тегов перед отправкой: ${formattedText.substring(0, Math.min(100, formattedText.length))}...`, 'social-publishing');
      
      // Проверяем длину после форматирования
      const finalText = formattedText.length > 4096 ? formattedText.substring(0, 4093) + '...' : formattedText;
      
      // Преобразуем текст с HTML-тегами, если он есть
      if (finalText.includes('<') && finalText.includes('>')) {
        log(`Обнаружены HTML-теги в тексте для Telegram, длина: ${finalText.length}`, 'social-publishing');
      } else {
        // Для обычного текста без HTML-тегов дополнительные проверки не требуются
        log(`Обычный текст без HTML-тегов для Telegram, длина: ${finalText.length}`, 'social-publishing');
      }
      
      // Подготавливаем тело запроса для API Telegram
      const messageBody = {
        chat_id: chatId,
        text: finalText,
        parse_mode: 'HTML',
        protect_content: false, // Защита контента (можно настроить)
        disable_notification: false // Отключение уведомлений (можно настроить)
      };
      
      // Отправляем запрос в API Telegram
      const baseUrl = `https://api.telegram.org/bot${token}`;
      const response = await axios.post(`${baseUrl}/sendMessage`, messageBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000, // Увеличенный таймаут
        validateStatus: () => true // Всегда возвращаем ответ, даже если это ошибка
      });
      
      // Обрабатываем ответ
      if (response.status === 200 && response.data && response.data.ok) {
        const messageId = response.data?.result?.message_id;
        log(`Сообщение успешно отправлено в Telegram, message_id: ${messageId}`, 'social-publishing');
        return { success: true, result: response.data?.result, messageId };
      } else {
        log(`Ошибка при отправке сообщения в Telegram: ${JSON.stringify(response.data)}`, 'social-publishing');
        
        // Если ошибка связана с HTML-тегами, пробуем исправить их и отправить снова
        if (response.data?.description?.includes("can't parse entities") || 
            response.data?.description?.includes("can't find end tag") ||
            response.data?.description?.includes("Bad Request") && finalText.includes('<')) {
          
          log(`Ошибка при отправке HTML-форматированного текста: код ${response.status}, ${response.data?.description}`, 'social-publishing');
          
          // Пробуем агрессивно исправить HTML разметку
          const forceFixedHtml = this.aggressiveTagFixer(finalText);
          log(`Пробуем отправить с исправленным HTML-форматированием...`, 'social-publishing');
          
          const fixedMessageBody = {
            chat_id: chatId,
            text: forceFixedHtml,
            parse_mode: 'HTML',
            protect_content: false,
            disable_notification: false
          };
          
          try {
            const fixedResponse = await axios.post(`${baseUrl}/sendMessage`, fixedMessageBody, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 30000,
              validateStatus: () => true
            });
            
            if (fixedResponse.status === 200 && fixedResponse.data && fixedResponse.data.ok) {
              const messageId = fixedResponse.data?.result?.message_id;
              log(`Сообщение успешно отправлено после агрессивного исправления HTML, message_id: ${messageId}`, 'social-publishing');
              return { success: true, result: fixedResponse.data?.result, messageId };
            } else {
              log(`Не удалось отправить сообщение даже после агрессивного исправления HTML: ${JSON.stringify(fixedResponse.data)}`, 'social-publishing');
            }
          } catch (fixError) {
            log(`Исключение при отправке исправленного HTML: ${fixError}`, 'social-publishing');
          }
        }
        
        // Если текст содержит HTML и произошла ошибка, пробуем отправить как обычный текст
        if (finalText.includes('<') && finalText.includes('>')) {
          log(`Пробуем отправить как обычный текст без HTML...`, 'social-publishing');
          
          // Удаляем все HTML-теги и создаем новое тело запроса
          const plainText = text.replace(/<[^>]*>/g, '');
          const plainMessageBody = {
            chat_id: chatId,
            text: plainText.length > 4096 ? plainText.substring(0, 4093) + '...' : plainText,
            protect_content: false,
            disable_notification: false
          };
          
          // Отправляем повторный запрос без HTML
          const plainResponse = await axios.post(`${baseUrl}/sendMessage`, plainMessageBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true
          });
          
          if (plainResponse.status === 200 && plainResponse.data && plainResponse.data.ok) {
            const messageId = plainResponse.data?.result?.message_id;
            log(`Сообщение успешно отправлено без HTML-форматирования, message_id: ${messageId}`, 'social-publishing');
            return { success: true, result: plainResponse.data?.result, messageId };
          } else {
            log(`Ошибка при отправке обычного текста: ${JSON.stringify(plainResponse.data)}`, 'social-publishing');
            return { success: false, error: plainResponse.data?.description || 'Failed to send plain text' };
          }
        }
        
        return { success: false, error: response.data?.description || 'Failed to send message' };
      }
    } catch (error) {
      log(`Исключение при отправке сообщения в Telegram: ${error}`, 'social-publishing');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    
    // Этот код никогда не должен выполняться, но на всякий случай добавляем предупреждение
    log(`КРИТИЧЕСКАЯ ОШИБКА: Метод sendTextMessageToTelegram завершился без явного возврата результата`, 'social-publishing');
    return { success: false, error: 'Method completed without explicit return' };
  }

  /**
   * Универсальный метод для отправки изображений в Telegram
   * @param chatId ID чата Telegram 
   * @param token Токен бота Telegram
   * @param images Массив URL изображений
   * @param baseUrl Базовый URL API Telegram
   * @param caption Текстовая подпись к изображениям (опционально)
   * @returns Результат отправки (успех/ошибка)
   */
  private async sendImagesToTelegram(
    chatId: string,
    token: string,
    images: string[],
    baseUrl: string,
    caption?: string
  ): Promise<{ success: boolean; error: string; messageId?: number; messageUrl?: string }> {
    try {
      if (!images || images.length === 0) {
        return { success: false, error: 'No images provided' };
      }
      
      let lastMessageId: number | undefined;
      
      // Если только одно изображение, отправляем его через sendPhoto
      if (images.length === 1) {
        log(`Отправка одного изображения через sendPhoto: ${images[0]}`, 'social-publishing');
        
        try {
          // Создаем объект запроса с дополнительными параметрами если есть подпись
          const requestBody: any = {
            chat_id: chatId,
            photo: images[0]
          };
          
          // Если есть текст подписи, добавляем его и форматируем
          if (caption && caption.trim() !== '') {
            // Форматируем подпись с помощью нашего метода для HTML-тегов
            let formattedCaption = this.formatTextForTelegram(caption);
            // Дополнительно применяем агрессивный исправитель тегов
            formattedCaption = this.aggressiveTagFixer(formattedCaption);
            log(`Подпись после агрессивного исправления тегов: ${formattedCaption.substring(0, Math.min(100, formattedCaption.length))}...`, 'social-publishing');
            // Telegram caption limit is 1024 chars — if longer, send without caption (text sent separately by caller)
            if (formattedCaption.length <= 1024) {
              requestBody.caption = formattedCaption;
              requestBody.parse_mode = 'HTML';
              log(`Добавляем форматированную текстовую подпись к изображению (${formattedCaption.length} символов)`, 'social-publishing');
            } else {
              log(`Подпись слишком длинная (${formattedCaption.length} символов > 1024), отправляем изображение без подписи`, 'social-publishing');
            }
          }
          
          const response = await axios.post(`${baseUrl}/sendPhoto`, requestBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true
          });
          
          if (response.status === 200 && response.data && response.data.ok) {
            lastMessageId = response.data.result.message_id;
            log(`Изображение успешно отправлено, message_id: ${lastMessageId}`, 'social-publishing');
            
            // Генерируем URL сообщения, используя безопасную функцию formatTelegramUrl
            let formattedChatId = chatId;
            if (chatId.startsWith('-100')) {
              formattedChatId = chatId.substring(4);
            }
            
            // Проверяем наличие messageId (обязательное требование!)
            if (!lastMessageId) {
              log(`КРИТИЧЕСКАЯ ОШИБКА: Отсутствует messageId при формировании URL для изображения`, 'social-publishing');
              return { success: false, error: 'MessageId is required for Telegram URL formation' };
            }
            
            // Формируем URL с обязательным messageId
            const messageUrl = this.formatTelegramUrl(chatId, formattedChatId, lastMessageId, this.currentChatUsername);
            log(`Сгенерирован URL для сообщения с изображением: ${messageUrl}`, 'social-publishing');
              
            return { 
              success: true, 
              error: '',  // Добавляем пустую строку для соответствия типу
              messageId: lastMessageId,
              messageUrl: messageUrl
            };
          } else {
            log(`Ошибка при отправке изображения: ${JSON.stringify(response.data)}`, 'social-publishing');
            return { success: false, error: response.data?.description || 'Failed to send image' };
          }
        } catch (error) {
          log(`Исключение при отправке изображения: ${error}`, 'social-publishing');
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      // Если несколько изображений, отправляем их через sendMediaGroup (до 10 штук)
      else {
        // Telegram ограничивает группы медиа до 10 элементов
        const chunks = [];
        for (let i = 0; i < images.length; i += 10) {
          chunks.push(images.slice(i, i + 10));
        }
        
        log(`Отправка ${images.length} изображений через sendMediaGroup (${chunks.length} групп)`, 'social-publishing');
        
        // Отправляем каждую группу изображений последовательно
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          try {
            // Создаем медиа-группу для API Telegram
            const media = chunk.map((img, index) => {
              // Проверяем, что изображение имеет URL
              const imageUrl = img && typeof img === 'string' ? img : '';
              if (!imageUrl) {
                log(`Предупреждение: пустой URL изображения в группе`, 'social-publishing');
              }
              
              // Добавляем подпись только к первому изображению в первой группе
              if (i === 0 && index === 0 && caption && caption.trim() !== '') {
                // Форматируем подпись с помощью нашего метода для HTML-тегов
                let formattedCaption = this.formatTextForTelegram(caption);
                // Дополнительно применяем агрессивный исправитель тегов
                formattedCaption = this.aggressiveTagFixer(formattedCaption);
                log(`Подпись к группе изображений после агрессивного исправления тегов: ${formattedCaption.substring(0, Math.min(100, formattedCaption.length))}...`, 'social-publishing');
                // Telegram caption limit is 1024 chars — if longer, send without caption
                if (formattedCaption.length <= 1024) {
                  return {
                    type: 'photo',
                    media: imageUrl,
                    caption: formattedCaption,
                    parse_mode: 'HTML'
                  };
                }
                log(`Подпись к группе слишком длинная (${formattedCaption.length} символов > 1024), отправляем без подписи`, 'social-publishing');
              }
              {
                return {
                  type: 'photo',
                  media: imageUrl
                };
              }
            });
            
            // Проверяем, что есть хотя бы одно корректное изображение
            if (media.length === 0 || !media.some(m => m.media)) {
              log(`Ошибка: нет корректных URL изображений для отправки в группе`, 'social-publishing');
              continue; // Пропускаем эту группу и переходим к следующей
            }
            
            const response = await axios.post(`${baseUrl}/sendMediaGroup`, {
              chat_id: chatId,
              media
            }, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 60000, // Увеличенный таймаут для группы
              validateStatus: () => true
            });
            
            if (response.status === 200 && response.data && response.data.ok) {
              // Сохраняем message_id последнего сообщения
              if (response.data.result && response.data.result.length > 0) {
                lastMessageId = response.data.result[0].message_id;
                log(`Группа изображений успешно отправлена, первый message_id: ${lastMessageId}`, 'social-publishing');
              }
            } else {
              log(`Ошибка при отправке группы изображений: ${JSON.stringify(response.data)}`, 'social-publishing');
              return { success: false, error: response.data?.description || 'Failed to send image group' };
            }
          } catch (error) {
            log(`Исключение при отправке группы изображений: ${error}`, 'social-publishing');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        
        // Генерируем URL сообщения, используя безопасную функцию formatTelegramUrl
        let formattedChatId = chatId;
        if (chatId.startsWith('-100')) {
          formattedChatId = chatId.substring(4);
        }
        
        // Проверяем наличие messageId (обязательное требование!)
        if (!lastMessageId) {
          log(`КРИТИЧЕСКАЯ ОШИБКА: Отсутствует messageId при формировании URL для группы изображений`, 'social-publishing');
          return { success: false, error: 'MessageId is required for Telegram URL formation' };
        }
        
        const messageUrl = this.formatTelegramUrl(chatId, formattedChatId, lastMessageId, this.currentChatUsername);
        log(`Сгенерирован URL для группы изображений: ${messageUrl}`, 'social-publishing');
        
        // Если все группы успешно отправлены
        return { 
          success: true, 
          error: '',  // Добавляем пустую строку для соответствия типу
          messageId: lastMessageId,
          messageUrl: messageUrl
        };
      }
    } catch (error) {
      log(`Ошибка при отправке изображений в Telegram: ${error}`, 'social-publishing');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Получает информацию о чате в Telegram
   * @param chatId ID чата
   * @param token Токен бота
   * @returns Информация о чате или null в случае ошибки
   */
  private async getChatInfo(chatId: string, token: string): Promise<any | null> {
    try {
      log(`Запрос информации о чате: ${chatId}`, 'social-publishing');
      const baseUrl = `https://api.telegram.org/bot${token}`;
      
      // Используем post чтобы быть совместимым с другими методами API и тестами
      const response = await axios.post(`${baseUrl}/getChat`, {
        chat_id: chatId
      }, {
        timeout: 10000,
        validateStatus: () => true
      });
      
      // FIX: Улучшена обработка ответов API
      if (response.data && response.data.ok === true && response.data.result) {
        log(`Успешно получена информация о чате: ${JSON.stringify(response.data.result)}`, 'social-publishing');
        
        // Если в ответе есть username, сохраним его в свойстве экземпляра класса
        if (response.data.result.username) {
          this.currentChatUsername = response.data.result.username;
          log(`Сохранен username чата: ${this.currentChatUsername}`, 'social-publishing');
        }
        
        return response.data.result;
      } else {
        // Только в случае реальной ошибки выводим сообщение об ошибке
        log(`Ошибка API Telegram при получении информации о чате: ${JSON.stringify(response.data || 'Нет данных в ответе')}`, 'social-publishing');
        return null;
      }
    } catch (error) {
      log(`Исключение при запросе информации о чате: ${error instanceof Error ? error.message : String(error)}`, 'social-publishing');
      return null;
    }
  }

  /**
   * Вспомогательный метод для генерации URL сообщения в этом контексте публикации
   * Использует chatUsername из текущего контекста
   * @param chatId Исходный chat ID (может быть @username или числовым ID)
   * @param formattedChatId Форматированный chat ID для API запросов
   * @param messageId ID сообщения
   * @returns URL сообщения
   */
  /**
   * Генерирует URL для поста в Telegram
   * ВАЖНО: messageId является ОБЯЗАТЕЛЬНЫМ параметром в соответствии с TELEGRAM_POSTING_ALGORITHM.md
   * URL без messageId считается некорректным и не допускается согласно алгоритму!
   *
   * @param chatId ID чата Telegram
   * @param formattedChatId Форматированный ID чата для API
   * @param messageId ID сообщения (обязательный параметр)
   * @returns Полный URL для поста в Telegram
   * @throws Error если messageId не указан или пуст
   */
  private generatePostUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
    // Обязательная проверка messageId - ID сообщения должен присутствовать всегда!
    if (!messageId) {
      log(`КРИТИЧЕСКАЯ ОШИБКА: Попытка создать URL без messageId. Это нарушает алгоритм TELEGRAM_POSTING_ALGORITHM.md. chatId=${chatId}`, 'social-publishing');
      throw new Error('MessageId is REQUIRED for Telegram URL formation according to TELEGRAM_POSTING_ALGORITHM.md');
    }

    log(`Генерация URL для Telegram с chatId=${chatId}, formattedChatId=${formattedChatId}, messageId=${messageId}`, 'social-publishing');
    const url = this.formatTelegramUrl(chatId, formattedChatId, messageId, this.currentChatUsername);
    log(`Сгенерирован URL для Telegram: ${url}`, 'social-publishing');
    return url;
  }
  
  /**
   * Агрессивный исправитель HTML-тегов для обработки всех возможных случаев
   * @param text Исходный HTML-текст
   * @returns Исправленный HTML-текст с правильными закрытыми тегами
   * @public
   */
  public aggressiveTagFixer(text: string): string {
    if (!text) return text;
    
    try {
      // Список поддерживаемых Telegram тегов и их стандартизированные эквиваленты
      const tagMap: Record<string, string> = {
        'b': 'b', 'strong': 'b',
        'i': 'i', 'em': 'i',
        'u': 'u', 'ins': 'u',
        's': 's', 'strike': 's', 'del': 's',
        'code': 'code', 'pre': 'pre'
      };
      
      const supportedTags = Object.keys(tagMap);
      
      // 1. Удаляем нежелательный текст, который иногда появляется
      let cleanedText = text.replace(/Подсознание наизнанку/g, '');
      
      // 2. Стандартизируем все типы HTML-тегов к поддерживаемым Telegram форматам
      let fixedText = cleanedText
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>')
        .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '<u>$1</u>')
        .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '<s>$1</s>')
        .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '<s>$1</s>');
      
      // 3. Удаляем все неподдерживаемые теги, сохраняя их содержимое
      const unsupportedTagPattern = new RegExp(`<\\/?(?!${supportedTags.join('|')}|a\\b)[^>]+>`, 'gi');
      fixedText = fixedText.replace(unsupportedTagPattern, '');
      
      // 4. Обработка тегов ссылок
      fixedText = fixedText.replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/g, '<a href="$1">$2</a>');
      
      // 5. Находим и анализируем все оставшиеся HTML-теги
      const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
      
      let match: RegExpExecArray | null;
      const tagMatches: Array<{index: number, fullTag: string, tagName: string}> = [];
      
      while ((match = tagPattern.exec(fixedText)) !== null) {
        tagMatches.push({
          index: match.index,
          fullTag: match[0],
          tagName: match[1].toLowerCase()
        });
      }
      
      if (tagMatches.length === 0) {
        // Если тегов нет, просто возвращаем текст
        return fixedText;
      }
      
      // 6. Создаем структуру для анализа открытия/закрытия тегов
      const stack: string[] = [];
      const resultParts: string[] = [];
      let lastIndex = 0;
      
      for (const match of tagMatches) {
        const fullTag = match.fullTag;
        const tagName = match.tagName;
        const isClosing = fullTag.startsWith('</');
        const position = match.index;
        
        // Добавляем текст до текущего тега
        resultParts.push(fixedText.substring(lastIndex, position));
        lastIndex = position + fullTag.length;
        
        // Обрабатываем только поддерживаемые теги
        if (supportedTags.includes(tagName) || tagName === 'a') {
          if (!isClosing) {
            // Открывающий тег
            if (tagName === 'a') {
              // Для ссылок сохраняем href атрибут
              const hrefMatch = fullTag.match(/href=["']([^"']*)["']/i);
              const href = hrefMatch ? hrefMatch[1] : '';
              resultParts.push(`<a href="${href}">`);
            } else {
              // Для других тегов используем стандартизированную форму
              resultParts.push(`<${tagMap[tagName] || tagName}>`);
            }
            stack.push(tagName);
          } else {
            // Закрывающий тег
            if (stack.length > 0) {
              // Если стек не пуст, проверяем соответствие
              let foundMatchingTag = false;
              
              // Ищем соответствующий открывающий тег, начиная с конца стека
              for (let i = stack.length - 1; i >= 0; i--) {
                const openTag = stack[i];
                // Проверяем совпадение (прямое или через отображение)
                if (openTag === tagName || (tagMap[openTag] === tagMap[tagName] && tagMap[openTag])) {
                  // Найден соответствующий тег
                  foundMatchingTag = true;
                  
                  // Закрываем все теги до найденного
                  for (let j = stack.length - 1; j >= i; j--) {
                    const tagToClose = stack[j];
                    if (tagToClose === 'a') {
                      resultParts.push('</a>');
                    } else {
                      resultParts.push(`</${tagMap[tagToClose] || tagToClose}>`);
                    }
                  }
                  
                  // Обновляем стек
                  stack.splice(i);
                  break;
                }
              }
              
              // Если не нашли соответствующий тег, добавляем закрывающий
              if (!foundMatchingTag) {
                if (tagName === 'a') {
                  resultParts.push('</a>');
                } else {
                  resultParts.push(`</${tagMap[tagName] || tagName}>`);
                }
              }
            } else {
              // Если стек пуст, просто добавляем закрывающий тег
              if (tagName === 'a') {
                resultParts.push('</a>');
              } else {
                resultParts.push(`</${tagMap[tagName] || tagName}>`);
              }
            }
          }
        }
        // Иначе тег игнорируется
      }
      
      // Добавляем оставшийся текст
      resultParts.push(fixedText.substring(lastIndex));
      
      // Закрываем все оставшиеся открытые теги
      for (let i = stack.length - 1; i >= 0; i--) {
        const tagToClose = stack[i];
        if (tagToClose === 'a') {
          resultParts.push('</a>');
        } else {
          resultParts.push(`</${tagMap[tagToClose] || tagToClose}>`);
        }
      }
      
      // Собираем результат
      let result = resultParts.join('');
      
      // Финальная проверка и упрощение, если что-то пошло не так
      const openingCount = (result.match(/<[a-z][^>]*>/gi) || []).length;
      const closingCount = (result.match(/<\/[a-z][^>]*>/gi) || []).length;
      
      if (openingCount !== closingCount) {
        log(`Критическая ошибка в балансе тегов после исправления: открывающих ${openingCount}, закрывающих ${closingCount}. Удаляем все теги.`, 'social-publishing');
        return text.replace(/<[^>]*>/g, '');
      }
      
      log(`Текст после агрессивного исправления HTML: ${result.substring(0, Math.min(100, result.length))}...`, 'social-publishing');
      
      return result;
    } catch (error) {
      log(`Ошибка в aggressiveTagFixer: ${error}`, 'social-publishing');
      // В случае любой ошибки возвращаем текст без HTML-разметки
      return text.replace(/<[^>]*>/g, '');
    }
  }
  
  formatTelegramUrl(chatId: string, formattedChatId: string, messageId: number | string, chatUsername?: string): string {
    // Сохраняем username для использования в generatePostUrl
    if (chatUsername) {
      this.currentChatUsername = chatUsername;
    }
    log(`Форматирование Telegram URL: chatId=${chatId}, formattedChatId=${formattedChatId}, messageId=${messageId}, username=${chatUsername || 'не указан'}`, 'social-publishing');
    
    // В соответствии с TELEGRAM_POSTING_ALGORITHM.md, messageId должен всегда присутствовать в URL
    if (!messageId) {
      log(`ОШИБКА: messageId не указан при формировании URL - это недопустимо по алгоритму`, 'social-publishing');
      throw new Error('MessageId is required for Telegram URL formation');
    }
    
    // Если известен username чата, используем его для URL
    if (chatUsername) {
      const url = `https://t.me/${chatUsername}/${messageId}`;
      log(`Сформирован URL для канала с известным username: ${url}`, 'social-publishing');
      return url;
    }
    
    // Стандартные случаи форматирования URL
    
    // Обработка случая с username (@channel)
    if (chatId.startsWith('@')) {
      const username = chatId.substring(1);
      const url = `https://t.me/${username}/${messageId}`;
      log(`Сформирован URL для канала с username: ${url}`, 'social-publishing');
      return url;
    }
    
    // Обработка случая с супергруппой/каналом (-100...)
    if (chatId.startsWith('-100')) {
      // Для приватных каналов используем формат с /c/
      // Для публичных - формат без /c/
      const channelId = chatId.substring(4);
      
      // Для приватных каналов (без username)
      if (!chatUsername) {
        const url = `https://t.me/c/${channelId}/${messageId}`;
        log(`Сформирован URL для приватного канала: ${url}`, 'social-publishing');
        return url;
      }
      
      // Для публичных супергрупп/каналов удаляем префикс -100
      const url = `https://t.me/${channelId}/${messageId}`;
      log(`Сформирован URL для публичного канала: ${url}`, 'social-publishing');
      return url;
    }
    
    // Обработка обычных групп (начинаются с -, но не с -100)
    if (chatId.startsWith('-') && !chatId.startsWith('-100')) {
      // Для обычной группы без username форматируем URL по стандарту с /c/
      const groupId = chatId.substring(1); // Убираем только минус
      const url = `https://t.me/c/${groupId}/${messageId}`;
      log(`Сформирован URL для обычной группы: ${url}`, 'social-publishing');
      return url;
    }
    
    // Личные чаты или боты (числовой ID без минуса)
    const url = `https://t.me/c/${chatId}/${messageId}`;
    log(`Сформирован URL для личного чата/бота: ${url}`, 'social-publishing');
    return url;
  }

  /**
   * Публикует контент в Telegram с использованием Imgur для изображений
   * @param content Контент для публикации
   * @param telegramSettings Настройки Telegram API
   * @returns Результат публикации
   */
  async publishToTelegram(
    content: CampaignContent,
    telegramSettings: { token: string | null; chatId: string | null }
  ): Promise<SocialPublication> {
    // ID последнего сообщения для формирования ссылки
    let lastMessageId: number | string | undefined;
    // Храним username канала, если его удастся получить
    let chatUsername: string | undefined;
    
    try {
      // Проверяем наличие необходимых параметров
      if (!telegramSettings.token || !telegramSettings.chatId) {
        log(`Ошибка публикации в Telegram: отсутствуют настройки. Token: ${telegramSettings.token ? 'задан' : 'отсутствует'}, ChatID: ${telegramSettings.chatId ? 'задан' : 'отсутствует'}`, 'social-publishing');
        return {
          platform: 'telegram',
          status: 'failed',
          publishedAt: null,
          error: 'Missing Telegram API settings (token or chatId)'
        };
      }
      
      // Извлекаем параметры
      const token = telegramSettings.token;
      const chatId = telegramSettings.chatId;
      
      // Форматируем ID чата для API Telegram (удаляем @ для username)
      const formattedChatId = chatId.startsWith('@') ? chatId : chatId;
      
      // Пытаемся получить информацию о чате для корректного формирования URL
      try {
        const chatInfo = await this.getChatInfo(formattedChatId, token);
        if (chatInfo && chatInfo.username) {
          chatUsername = chatInfo.username;
          // Сохраняем username чата в свойстве класса для дальнейшего использования
          this.currentChatUsername = chatUsername;
          log(`Получен username чата: ${chatUsername}`, 'social-publishing');
        } else {
          log(`Не удалось получить username чата или у чата нет публичного username`, 'social-publishing');
        }
      } catch (error) {
        log(`Ошибка при запросе информации о чате: ${error instanceof Error ? error.message : String(error)}`, 'social-publishing');
      }
      
      // Обрабатываем контент
      const processedContent = this.processAdditionalImages(content, 'telegram');
      
      // Загружаем локальные изображения на Imgur
      const imgurContent = await this.uploadImagesToImgur(processedContent);
      
      // Подготавливаем текст для отправки
      let text = '';
      
      // Если есть заголовок, добавляем его в начало сообщения
      if (imgurContent.title) {
        text += `<b>${imgurContent.title}</b>\n\n`;
      }
      
      // Добавляем основной контент
      const originalContent = imgurContent.content || '';
      const contentText = this.prepareTelegramText(originalContent);
      
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
      
      // Проверяем наличие видео (разные поля, в которых может храниться видео)
      const hasVideo = Boolean(
        processedContent.videoUrl || 
        (processedContent as any).video_url || 
        (processedContent.metadata && ((processedContent.metadata as any).video_url || (processedContent.metadata as any).videoUrl)) ||
        (processedContent.additionalMedia && Array.isArray(processedContent.additionalMedia) && 
          processedContent.additionalMedia.some((media: any) => 
            media.type === 'video' || (media.url && typeof media.url === 'string' && media.url.toLowerCase().match(/\.(mp4|avi|mov|wmv|flv|mkv)$/i))
          )
        )
      );
      
      // Проверяем необходимость принудительного разделения текста и изображений
      // Флаг устанавливается в методе publishToPlatform для всех Telegram публикаций
      const forceImageTextSeparation = processedContent.metadata && 
        (processedContent.metadata as any).forceImageTextSeparation === true;
      
      log(`Telegram: наличие изображений: ${hasImages}, наличие видео: ${hasVideo}, принудительное разделение: ${forceImageTextSeparation}`, 'social-publishing');
      
      // Определяем стратегию публикации в зависимости от наличия видео, изображений и текста
      
      // 0. Если есть видео, отправляем его через сервис TelegramS3Integration
      if (hasVideo) {
        log(`Telegram: публикация с видео. Отправляем через TelegramS3Integration.`, 'social-publishing');
        
        try {
          // Определяем URL видео из различных возможных источников
          // Проверяем все возможные локации URL видео
          let videoUrl = processedContent.videoUrl || undefined;
          
          // Проверяем альтернативное название поля
          if (!videoUrl && (processedContent as any).video_url) {
            videoUrl = (processedContent as any).video_url;
          }
          
          // Проверяем поля в метаданных
          if (!videoUrl && processedContent.metadata) {
            if ((processedContent.metadata as any).video_url) {
              videoUrl = (processedContent.metadata as any).video_url;
            } else if ((processedContent.metadata as any).videoUrl) {
              videoUrl = (processedContent.metadata as any).videoUrl;
            }
          }
          
          // Проверяем в additionalMedia
          if (!videoUrl && processedContent.additionalMedia && Array.isArray(processedContent.additionalMedia)) {
            const videoMedia = processedContent.additionalMedia.find((media: any) => {
              if (media.type === 'video') return true;
              if (media.url && typeof media.url === 'string') {
                return media.url.toLowerCase().match(/\.(mp4|avi|mov|wmv|flv|mkv)$/i) !== null;
              }
              return false;
            });
            
            if (videoMedia && videoMedia.url) {
              videoUrl = videoMedia.url;
            }
          }
          
          if (!videoUrl) {
            log(`Ошибка: Видео обнаружено, но URL не найден`, 'social-publishing');
            throw new Error('Video URL not found in content');
          }
          
          log(`Отправка видео в Telegram: ${videoUrl}`, 'social-publishing');
          
          // Подготавливаем текст в качестве подписи к видео
          const videoCaption = text.length <= 1024 ? text : text.substring(0, 1021) + '...';
          
          // Отправляем видео через специализированный сервис
          const videoResult = await this.telegramS3Integration.sendVideoToTelegram(
            videoUrl,
            formattedChatId,
            token,
            {
              caption: videoCaption,
              parse_mode: 'HTML'
            }
          );
          
          if (videoResult.success) {
            log(`Видео успешно отправлено в Telegram, ID сообщения: ${videoResult.messageId}`, 'social-publishing');
            
            // Убедимся, что messageId определен перед использованием
            if (!videoResult.messageId) {
              log(`Предупреждение: messageId не получен от сервиса отправки видео`, 'social-publishing');
              return {
                platform: 'telegram',
                status: 'published',
                publishedAt: new Date(),
                postUrl: 'https://t.me/' + (chatId.startsWith('@') ? chatId.substring(1) : chatId) // Временная ссылка
              };
            }
            
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              postUrl: this.generatePostUrl(chatId, formattedChatId, videoResult.messageId || '0')
            };
          } else {
            log(`Ошибка при отправке видео в Telegram: ${videoResult.error}`, 'social-publishing');
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Ошибка при отправке видео: ${videoResult.error}`
            };
          }
        } catch (error: any) {
          log(`Исключение при отправке видео в Telegram: ${error.message}`, 'social-publishing');
          return {
            platform: 'telegram',
            status: 'failed',
            publishedAt: null,
            error: `Исключение при отправке видео: ${error.message}`
          };
        }
      }
      
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
        let imagesSentResult: {
          success: boolean;
          error: string;
          messageId?: number | string;
          messageUrl?: string;
        } = { 
          success: false, 
          error: 'Изображения не отправлены' 
        };
        
        if (images.length > 0) {
          log(`Отправка всех ${images.length} изображений через универсальный метод`, 'social-publishing');
          
          // Если текст <= 1024 — передаём как caption, иначе шлём без подписи и отдельно
          const captionForImages = text.length <= 1024 ? text : '';
          imagesSentResult = await this.sendImagesToTelegram(
            formattedChatId,
            token,
            images,
            baseUrl,
            captionForImages || undefined
          );
          
          if (!imagesSentResult.success) {
            log(`Ошибка при отправке изображений в Telegram: ${imagesSentResult.error}`, 'social-publishing');
          } else {
            log(`Все изображения успешно отправлены в Telegram`, 'social-publishing');
            log(`URL сообщения с изображениями: ${imagesSentResult.messageUrl || 'не создан'}`, 'social-publishing');
          }
        }
        
        // Если текст не поместился в подпись — отправляем отдельным сообщением
        if (text.length > 1024 && imagesSentResult && imagesSentResult.success) {
          log(`Текст длиннее 1024 символов (${text.length}), отправляем отдельным сообщением`, 'social-publishing');
          try {
            const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
            if (textResponse.success) {
              log(`Текст успешно отправлен отдельно после изображений`, 'social-publishing');
            } else {
              log(`Ошибка при отправке текста отдельно: ${textResponse.error}`, 'social-publishing');
            }
          } catch (textErr: any) {
            log(`Исключение при отправке текста отдельно: ${textErr.message}`, 'social-publishing');
          }
        }
        
        // Используем результат предыдущей отправки изображений
        if (imagesSentResult && imagesSentResult.success) {
          log(`Публикация в Telegram завершена успешно (изображения с подписью)`, 'social-publishing');
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            postUrl: imagesSentResult.messageUrl || (imagesSentResult.messageId ? this.generatePostUrl(chatId, formattedChatId, imagesSentResult.messageId) : undefined)
          };
        } else {
          // Если возникла проблема с отправкой изображений, попробуем отправить только текст
          try {
            log(`Отправка изображений с подписью не удалась, пробуем отправить только текст: ${text.length} символов`, 'social-publishing');
              
            // Если текст превышает максимальную длину для Telegram (4096 символов),
            // он будет автоматически обрезан в методе sendTextMessageToTelegram
            const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
            log(`Текст успешно отправлен в Telegram: ${JSON.stringify(textResponse)}`, 'social-publishing');
            
            // Обновляем lastMessageId если есть message_id
            if (textResponse.result && textResponse.result.message_id) {
              lastMessageId = textResponse.result.message_id;
            }
              
            // В соответствии с TELEGRAM_POSTING_ALGORITHM.md, URL должен содержать message_id
            // Если lastMessageId не получен, выбрасываем ошибку
            if (!lastMessageId) {
              log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
              throw new Error('MessageId is required for Telegram URL formation');
            }
            
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId)
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
            
            // Получаем ID сообщения
            const messageId = response.data?.result?.message_id;
            log(`ID сообщения с изображением: ${messageId || 'не получен'}`, 'social-publishing');
            
            // Генерируем URL для этого сообщения
            const postUrl = this.generatePostUrl(chatId, formattedChatId, messageId);
            log(`Сгенерирован URL для сообщения с изображением: ${postUrl}`, 'social-publishing');
            
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              postUrl,
              messageId  // Добавляем ID сообщения в результат
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
                  
                  // Проверяем наличие messageId согласно требованиям TELEGRAM_POSTING_ALGORITHM.md
                  if (!lastMessageId) {
                    log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
                    throw new Error('MessageId is required for Telegram URL formation');
                  }
                  
                  return {
                    platform: 'telegram',
                    status: 'published',
                    publishedAt: new Date(),
                    postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId)
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
                    
                    // В соответствии с TELEGRAM_POSTING_ALGORITHM.md, URL должен содержать message_id
                    if (!lastMessageId) {
                      log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
                      throw new Error('MessageId is required for Telegram URL formation');
                    }
                    
                    return {
                      platform: 'telegram',
                      status: 'published',
                      publishedAt: new Date(),
                      postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId)
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
              
              // Проверяем наличие messageId в соответствии с TELEGRAM_POSTING_ALGORITHM.md
              if (!lastMessageId) {
                log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
                throw new Error('MessageId is required for Telegram URL formation');
              }
              
              return {
                platform: 'telegram',
                status: 'published',
                publishedAt: new Date(),
                postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId)
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
              log(`Отправка основного изображения: ${processedContent.imageUrl}`, 'social-publishing');
              
              // Формируем полный URL, если это локальный путь
              let imageUrl = processedContent.imageUrl;
              if (!imageUrl.startsWith('http')) {
                const baseAppUrl = this.getAppBaseUrl();
                imageUrl = `${baseAppUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                log(`Исправлен URL для основного изображения: ${imageUrl}`, 'social-publishing');
              }
              
              // Отправляем изображение с подписью
              const photoResponse = await axios.post(`${baseUrl}/sendPhoto`, {
                chat_id: formattedChatId,
                photo: imageUrl,
                caption: imageCaption,
                parse_mode: 'HTML'
              }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000,
                validateStatus: () => true
              });
              
              if (photoResponse.status === 200 && photoResponse.data && photoResponse.data.ok) {
                log(`Основное изображение успешно отправлено: ${JSON.stringify(photoResponse.data)}`, 'social-publishing');
                
                // Сохраняем ID сообщения
                if (photoResponse.data.result && photoResponse.data.result.message_id) {
                  lastMessageId = photoResponse.data.result.message_id;
                }
              } else {
                log(`Ошибка при отправке основного изображения: ${JSON.stringify(photoResponse.data)}`, 'social-publishing');
              }
            } catch (photoError: any) {
              log(`Исключение при отправке основного изображения: ${photoError.message}`, 'social-publishing');
            }
          }
          
          // Отправляем дополнительные изображения, если они есть
          if (processedContent.additionalImages && processedContent.additionalImages.length > 0) {
            try {
              // Ограничение в 10 изображений для Telegram API
              const mediaItems = processedContent.additionalImages.slice(0, 10).map(img => ({
                type: 'photo',
                media: img
              }));
              
              if (mediaItems.length > 0) {
                log(`Отправка ${mediaItems.length} дополнительных изображений через sendMediaGroup`, 'social-publishing');
                
                const mediaResponse = await axios.post(`${baseUrl}/sendMediaGroup`, {
                  chat_id: formattedChatId,
                  media: mediaItems
                }, {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 60000, // Увеличенный таймаут для группы изображений
                  validateStatus: () => true
                });
                
                if (mediaResponse.status === 200 && mediaResponse.data && mediaResponse.data.ok) {
                  log(`Группа изображений успешно отправлена: ${JSON.stringify(mediaResponse.data)}`, 'social-publishing');
                  
                  // Обновляем lastMessageId при необходимости
                  if (mediaResponse.data.result && mediaResponse.data.result.length > 0) {
                    // Детальное логирование полученных данных
                    log(`Детальный анализ ответа sendMediaGroup: Получено ${mediaResponse.data.result.length} сообщений`, 'social-publishing');
                    
                    // Перебираем все сообщения и выводим информацию о них
                    mediaResponse.data.result.forEach((msg: any, idx: number) => {
                      log(`Сообщение ${idx+1}: ID=${msg.message_id || 'не найден'}, присутствие фото: ${!!msg.photo}`, 'social-publishing');
                    });
                    
                    // Берем ID первого сообщения для формирования ссылки
                    lastMessageId = mediaResponse.data.result[0].message_id;
                    log(`Выбран ID первого сообщения из группы: ${lastMessageId}`, 'social-publishing');
                  } else {
                    log(`Внимание! В ответе sendMediaGroup не найдены результаты сообщений`, 'social-publishing');
                  }
                } else {
                  log(`Ошибка при отправке группы изображений: ${JSON.stringify(mediaResponse.data)}`, 'social-publishing');
                }
              }
            } catch (mediaError: any) {
              log(`Исключение при отправке группы изображений: ${mediaError.message}`, 'social-publishing');
            }
          }
          
          // Если у нас длинный текст, который не поместился в подпись изображения,
          // отправляем его отдельным сообщением
          if (text.length > 1024) {
            try {
              log(`Отправка длинного текста отдельным сообщением (${text.length} символов)`, 'social-publishing');
              
              const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
              
              if (textResponse.success) {
                log(`Текст успешно отправлен отдельно: ${JSON.stringify(textResponse.result)}`, 'social-publishing');
                
                // Если нет lastMessageId от изображений, используем ID сообщения с текстом
                if (!lastMessageId && textResponse.result && textResponse.result.message_id) {
                  lastMessageId = textResponse.result.message_id;
                }
              } else {
                log(`Ошибка при отправке текста отдельно: ${textResponse.error}`, 'social-publishing');
              }
            } catch (textError: any) {
              log(`Исключение при отправке текста отдельно: ${textError.message}`, 'social-publishing');
            }
          }
          
          // Если удалось отправить хотя бы что-то (есть lastMessageId), считаем публикацию успешной
          if (lastMessageId) {
            return {
              platform: 'telegram',
              status: 'published',
              publishedAt: new Date(),
              postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId),
              messageId: lastMessageId // Добавляем ID сообщения в результат
            };
          } else {
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: 'Failed to send media content'
            };
          }
        }
        // Если нет изображений, просто отправляем текст
        else {
          try {
            log(`Отправка только текста, длина: ${text.length} символов`, 'social-publishing');
            
            const textResponse = await this.sendTextMessageToTelegram(text, formattedChatId, token);
            
            if (textResponse.success) {
              log(`Текст успешно отправлен: ${JSON.stringify(textResponse.result)}`, 'social-publishing');
              
              // Сохраняем ID сообщения для формирования ссылки
              if (textResponse.result && textResponse.result.message_id) {
                lastMessageId = textResponse.result.message_id;
                log(`ID сообщения получен из текстового ответа: ${lastMessageId}`, 'social-publishing');
              } else {
                log(`Внимание! ID сообщения не получен из текстового ответа. Проверьте содержимое ответа: ${JSON.stringify(textResponse)}`, 'social-publishing');
              }
              
              // Убеждаемся, что у нас есть ID сообщения для правильной ссылки
              if (lastMessageId) {
                log(`Формируем URL с ID сообщения: ${lastMessageId}`, 'social-publishing');
                return {
                  platform: 'telegram',
                  status: 'published',
                  publishedAt: new Date(),
                  postUrl: this.generatePostUrl(chatId, formattedChatId, lastMessageId),
                  messageId: lastMessageId // Добавляем ID сообщения в результат
                };
              } else {
                // В соответствии с требованиями TELEGRAM_POSTING_ALGORITHM.md, URL всегда должен содержать messageId
                log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
                throw new Error('MessageId is required for Telegram URL formation');
              }
            } else {
              log(`Ошибка при отправке текста: ${textResponse.error}`, 'social-publishing');
              return {
                platform: 'telegram',
                status: 'failed',
                publishedAt: null,
                error: `Failed to send text: ${textResponse.error}`
              };
            }
          } catch (textError: any) {
            log(`Исключение при отправке текста: ${textError.message}`, 'social-publishing');
            return {
              platform: 'telegram',
              status: 'failed',
              publishedAt: null,
              error: `Exception while sending text: ${textError.message}`
            };
          }
        }
      }
    } catch (error: any) {
      log(`Ошибка при публикации в Telegram: ${error.message}`, 'social-publishing');
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: `Publication error: ${error.message}`
      };
    }
  }

  /**
   * Публикует контент в выбранную социальную платформу
   * @param content Контент для публикации
   * @param platform Социальная платформа
   * @param settings Настройки социальных сетей
   * @returns Результат публикации
   */
  public async publishToPlatform(
    content: CampaignContent,
    platform: SocialPlatform,
    settings: SocialMediaSettings
  ): Promise<SocialPublication> {
    if (platform !== 'telegram') {
      return {
        platform: platform, 
        status: 'failed',
        publishedAt: null,
        error: 'Unsupported platform for TelegramService'
      };
    }

    // Проверяем наличие настроек и логируем их для дебага
    const telegramSettings = settings.telegram || { token: null, chatId: null };
    const hasToken = Boolean(telegramSettings.token);
    const hasChatId = Boolean(telegramSettings.chatId);
    
    log(`TelegramService.publishToPlatform: Настройки: hasToken=${hasToken}, hasChatId=${hasChatId}`, 'social-publishing');

    if (!hasToken || !hasChatId) {
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Telegram (токен или ID чата). Убедитесь, что настройки заданы в кампании.'
      };
    }

    // Для Telegram НЕ добавляем флаг принудительного разделения,
    // чтобы короткий текст без форматирования отправлялся как подпись к изображениям
    const contentWithMetadata = {
      ...content,
      metadata: {
        ...(content.metadata || {})
        // Убираем forceImageTextSeparation: true, чтобы текст отправлялся как подпись
      }
    };

    return this.publishToTelegram(contentWithMetadata, telegramSettings);
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const telegramService = new TelegramService();