import axios from 'axios';
import { log } from '../../utils/logger';
import type { SocialPlatform } from '@shared/schema';
import { BaseSocialService } from './base-service';

// Define interfaces for types not available in shared schema
interface CampaignContent {
  id: string;
  contentType: string;
  videoUrl?: string;
  imageUrl?: string;
  title?: string;
  content?: string;
  hashtags?: string[];
  metadata?: any;
  additionalMedia?: any[];
  userId?: string;
}

interface SocialPublication {
  platform: string;
  status: 'published' | 'failed' | 'pending';
  publishedAt: Date | null;
  postId?: string | null;
  postUrl?: string | null;
  error?: string | null;
  userId?: string;
}

interface SocialMediaSettings {
  instagram?: {
    token: string | null;
    accessToken: string | null;
    businessAccountId: string | null;
    appId?: string | null;
    appSecret?: string | null;
  };
}
import * as fs from 'fs';
import * as path from 'path';

// Вспомогательная функция для задержки выполнения кода
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Сервис для публикации контента в Instagram
 */
export class InstagramService extends BaseSocialService {
  /**
   * Форматирует текст для публикации в Instagram
   * @param content Исходный текст контента
   * @returns Отформатированный текст для Instagram
   */
  private formatTextForInstagram(content: string): string {
    if (!content || typeof content !== 'string') {
      return '';
    }
    
    try {
      // Instagram не поддерживает HTML-теги, удаляем их
      let formattedText = content
        // Удаляем HTML-теги и заменяем их на обычный текст
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>([^]*?)<\/p>/g, '$1\n\n')
        .replace(/<div>([^]*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>([^]*?)<\/h[1-6]>/g, '$1\n\n')
        .replace(/<li>(.*?)<\/li>/g, '• $1\n')
        .replace(/<ul>(.*?)<\/ul>/g, '$1\n')
        .replace(/<ol>(.*?)<\/ol>/g, '$1\n')
        
        // Замена HTML-тегов форматирования на обычный текст
        .replace(/<b>(.*?)<\/b>/g, '$1')
        .replace(/<strong>(.*?)<\/strong>/g, '$1')
        .replace(/<i>(.*?)<\/i>/g, '$1')
        .replace(/<em>(.*?)<\/em>/g, '$1')
        
        // Преобразуем ссылки в обычный текст
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
        
        // Удаляем все остальные HTML-теги
        .replace(/<[^>]*>/g, '');
      
      // Нормализуем переносы строк (не более 2 подряд)
      formattedText = formattedText.replace(/\n{3,}/g, '\n\n');
      
      // Instagram имеет ограничение на длину текста (2200 символов)
      if (formattedText.length > 2200) {
        formattedText = formattedText.substring(0, 2197) + '...';
        log(`Текст для Instagram был обрезан до 2200 символов`, 'instagram');
      }
      
      return formattedText;
    } catch (error) {
      log(`Ошибка при форматировании текста для Instagram: ${error}`, 'instagram');
      
      // В случае ошибки возвращаем обрезанный исходный текст
      if (content.length > 2200) {
        return content.substring(0, 2197) + '...';
      }
      return content;
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
    instagramSettings: { token: string | null; accessToken: string | null; businessAccountId: string | null }
  ): Promise<SocialPublication> {
    try {
      // РАСШИРЕННОЕ ЛОГИРОВАНИЕ ПРИ ОТЛАДКЕ INSTAGRAM
      log(`[Instagram DEBUG] Начало попытки публикации в Instagram для контента ID: ${content.id}`, 'instagram');
      log(`[Instagram DEBUG] Параметры запроса: Token длина: ${instagramSettings.token ? instagramSettings.token.length : 0}, Business Account ID: ${instagramSettings.businessAccountId}`, 'instagram');
      
      try {
        // Выводим текущие данные социальных платформ
        if (content.socialPlatforms && content.socialPlatforms.instagram) {
          log(`[Instagram DEBUG] Текущие данные платформы Instagram: ${JSON.stringify(content.socialPlatforms.instagram)}`, 'instagram');
        }
      } catch (logError) {
        log(`[Instagram DEBUG] Ошибка при логировании данных платформы: ${logError}`, 'instagram');
      }
      
      // Проверяем наличие необходимых параметров
      if (!instagramSettings.token || !instagramSettings.businessAccountId) {
        log(`Ошибка публикации в Instagram: отсутствуют настройки. Token: ${instagramSettings.token ? 'задан' : 'отсутствует'}, Business Account ID: ${instagramSettings.businessAccountId ? 'задан' : 'отсутствует'}`, 'instagram');
        return {
          platform: 'instagram',
          status: 'failed',
          publishedAt: null,
          error: 'Отсутствуют настройки Instagram API (токен или ID бизнес-аккаунта)'
        };
      }
      
      // Проверяем альтернативное поле accessToken, которое может использоваться в некоторых контекстах
      let token = instagramSettings.token;
      if (!token && instagramSettings.accessToken) {
        token = instagramSettings.accessToken;
        log(`[Instagram] Использую альтернативное поле accessToken вместо token`, 'instagram');
      }
      
      // Убеждаемся, что токен валидный (не содержит только пробелы)
      if (token && typeof token === 'string' && token.trim() === '') {
        log(`[Instagram] Предупреждение: токен содержит только пробелы`, 'instagram');
        return {
          platform: 'instagram',
          status: 'failed',
          publishedAt: null,
          error: 'Токен Instagram содержит только пробелы'
        };
      }
      
      // Проверяем формат business account ID (должен быть числовым)
      const businessAccountId = instagramSettings.businessAccountId;
      if (businessAccountId && isNaN(Number(businessAccountId))) {
        log(`[Instagram] Предупреждение: Business Account ID должен быть числовым, получено: ${businessAccountId}`, 'instagram');
      }
      
      log(`[Instagram] Начинаем публикацию в Instagram с использованием бизнес-аккаунта: ${businessAccountId}`, 'instagram');
      
      // Обрабатываем контент
      const processedContent = this.processAdditionalImages(content, 'instagram');
      
      // Загружаем локальные изображения на Imgur
      const imgurContent = await this.uploadImagesToImgur(processedContent);
      
      // Более надежная проверка наличия медиа для Instagram
      // Проверяем наличие видео URL из всех возможных источников
      let videoUrl = null;
      
      // Проверяем несколько возможных полей для видео
      if (content.videoUrl && typeof content.videoUrl === 'string' && content.videoUrl.trim() !== '') {
        videoUrl = content.videoUrl;
        log(`[Instagram] Найдено видео в основном поле videoUrl: ${videoUrl}`, 'instagram');
      } else if ((content as any).video_url && typeof (content as any).video_url === 'string' && (content as any).video_url.trim() !== '') {
        videoUrl = (content as any).video_url;
        log(`[Instagram] Найдено видео в поле video_url: ${videoUrl}`, 'instagram');
      } else if (content.metadata && (content.metadata as any).videoUrl && typeof (content.metadata as any).videoUrl === 'string') {
        videoUrl = (content.metadata as any).videoUrl;
        log(`[Instagram] Найдено видео в metadata.videoUrl: ${videoUrl}`, 'instagram');
      } else if (content.metadata && (content.metadata as any).video_url && typeof (content.metadata as any).video_url === 'string') {
        videoUrl = (content.metadata as any).video_url;
        log(`[Instagram] Найдено видео в metadata.video_url: ${videoUrl}`, 'instagram');
      }
      
      // Проверяем наличие видео в additionalMedia
      if (!videoUrl && content.additionalMedia && Array.isArray(content.additionalMedia) && content.additionalMedia.length > 0) {
        const videoMedia = content.additionalMedia.find((media: any) => {
          if (media.type === 'video') return true;
          if (media.url && typeof media.url === 'string') {
            return media.url.toLowerCase().match(/\.(mp4|avi|mov|wmv|flv|mkv)$/i) !== null;
          }
          return false;
        });
        
        if (videoMedia && videoMedia.url) {
          videoUrl = videoMedia.url;
          log(`[Instagram] Найдено видео в additionalMedia: ${videoUrl}`, 'instagram');
        }
      }
      
      // Определяем окончательно, есть ли у нас видео
      const isVideo = (content.contentType === 'video-text' || content.contentType === 'video') && videoUrl !== null;
      
      // Если есть видео URL, проверяем нужно ли использовать прокси для Instagram
      if (videoUrl) {
        const { getInstagramCompatibleVideoUrl } = await import('../../utils/instagram-video-proxy-helper');
        const originalVideoUrl = videoUrl;
        videoUrl = getInstagramCompatibleVideoUrl(videoUrl);
        
        if (originalVideoUrl !== videoUrl) {
          log(`[Instagram] Используем прокси URL для совместимости с Instagram:`, 'instagram');
          log(`  Оригинальный: ${originalVideoUrl}`, 'instagram');  
          log(`  Прокси: ${videoUrl}`, 'instagram');
        }
      }
      
      // Расширенное логирование для диагностики
      log(`[Instagram DEBUG] Тип контента: ${content.contentType}, videoUrl: ${videoUrl ? 'найден' : 'не найден'}, isVideo: ${isVideo}`, 'instagram');
      
      // Проверяем, есть ли хоть какой-то медиа-контент (обязательно для Instagram)
      if (!isVideo && !imgurContent.imageUrl) {
        log(`[Instagram] Ошибка публикации: отсутствует медиа-контент (изображение или видео)`, 'instagram');
        return {
          platform: 'instagram',
          status: 'failed',
          publishedAt: null,
          error: 'Отсутствует медиа-контент для публикации в Instagram. Необходимо добавить изображение или видео.'
        };
      }
      
      // Подготавливаем текст для отправки
      let caption = '';
      
      // Если есть заголовок, добавляем его в начало сообщения
      if (imgurContent.title) {
        caption += `${imgurContent.title}\n\n`;
      }
      
      // Добавляем основной контент
      const formattedContent = this.formatTextForInstagram(imgurContent.content || '');
      caption += formattedContent;
      
      // Если есть хэштеги, добавляем их в конец сообщения
      if (imgurContent.hashtags && Array.isArray(imgurContent.hashtags) && imgurContent.hashtags.length > 0) {
        const hashtags = imgurContent.hashtags
          .filter(tag => tag && typeof tag === 'string' && tag.trim() !== '')
          .map(tag => tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`);
        
        if (hashtags.length > 0) {
          caption += '\n\n' + hashtags.join(' ');
        }
      }

      // Instagram Graph API ограничивает подпись 2200 символами
      caption = caption.substring(0, 2200);
      
      // Публикация в Instagram выполняется в 2 этапа:
      // 1. Отправка запроса на создание контейнера для медиа
      // 2. Публикация контейнера
      
      try {
        log(`[Instagram] Этап 1 - создание контейнера для медиа`, 'instagram');
        
        // Создаем URL для Instagram Graph API
        const baseUrl = 'https://graph.facebook.com/v17.0';
        
        // Формируем URL запроса для создания контейнера
        const containerUrl = `${baseUrl}/${businessAccountId}/media`;
        
        // Проверяем тип контента для определения правильного метода публикации (изображение или видео)
        // Используем обновленную переменную isVideo из улучшенной проверки выше
        
        // Подготавливаем параметры запроса в зависимости от типа контента
        // ВАЖНО: Для Instagram API требуется параметр media_type напрямую в теле запроса, а не в query params
        let containerParams: any = {};
        
        // Также передаем access_token в запросе создания контейнера (рекомендовано документацией)
        // Это может решить проблему с ошибкой "Object with ID does not exist"
        
        // Добавляем ссылку на медиа в зависимости от типа (изображение или видео)
        if (isVideo && videoUrl) {
          log(`[Instagram] Обнаружено видео для публикации: ${videoUrl.substring(0, 50)}...`, 'instagram');
          containerParams = {
            caption: caption,
            video_url: videoUrl,
            media_type: 'VIDEO', // ВАЖНО: Явно указываем тип медиа для Instagram в теле запроса
            access_token: token  // Добавляем токен доступа к запросу создания контейнера
          };
        } else {
          // Если это не видео или видео отсутствует, используем изображение
          log(`[Instagram] Публикация с изображением: ${imgurContent.imageUrl?.substring(0, 50)}...`, 'instagram');
          containerParams = {
            caption: caption,
            image_url: imgurContent.imageUrl,
            media_type: 'IMAGE', // ВАЖНО: Явно указываем тип медиа для Instagram в теле запроса
            access_token: token  // Добавляем токен доступа к запросу создания контейнера
          };
        }
        
        // Логируем тело запроса для отладки
        log(`[Instagram] Параметры запроса на создание контейнера: ${JSON.stringify(containerParams)}`, 'instagram');
        
        // Отправляем запрос на создание контейнера с увеличенными таймаутами для видео
        log(`[Instagram] Отправка запроса на создание контейнера для ${isVideo ? 'видео' : 'изображения'}`, 'instagram');
        
        let containerResponse;
        
        try {
          // Отправка запроса на создание контейнера
          containerResponse = await axios.post(
            containerUrl, 
            containerParams, 
            {
              headers: { 'Content-Type': 'application/json' },
              timeout: isVideo ? 120000 : 60000 // Увеличенный таймаут для видео (2 минуты)
            }
          );
          
          log(`[Instagram] Ответ API (создание контейнера): ${JSON.stringify(containerResponse.data)}`, 'instagram');
          
          // Проверка на наличие содержательного ответа
          if (!containerResponse.data) {
            throw new Error('Получен пустой ответ от Instagram API при создании контейнера');
          }
          
          // Проверяем успешность создания контейнера
          if (!containerResponse.data.id) {
            // Пытаемся найти описание ошибки в ответе
            const errorMsg = containerResponse.data.error ? 
              `${containerResponse.data.error.code}: ${containerResponse.data.error.message}` : 
              'Неизвестная ошибка при создании контейнера';
            
            throw new Error(errorMsg);
          }
          
          // ИСПРАВЛЕНО: Удален оператор return containerResponse, который прерывал выполнение функции
        } catch (error: any) {
          log(`[Instagram] Ошибка при создании контейнера: ${error.message}`, 'instagram');
          
          // Если ошибка связана с видео, пробуем загрузить изображение вместо него
          if (isVideo && imgurContent.imageUrl) {
            log(`[Instagram] Попытка создать контейнер с изображением вместо видео`, 'instagram');
            
            try {
              // Изменяем параметры запроса на изображение - создаем новый объект
              containerParams = {
                caption: caption,
                image_url: imgurContent.imageUrl,
                media_type: 'IMAGE',  // ВАЖНО: Явно указываем тип медиа для Instagram
                access_token: token  // Добавляем токен доступа к резервному запросу
              };
              
              // Повторно отправляем запрос с изображением
              containerResponse = await axios.post(
                containerUrl, 
                containerParams, 
                {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 60000
                }
              );
              
              log(`[Instagram] Ответ API при резервной загрузке изображения: ${JSON.stringify(containerResponse.data)}`, 'instagram');
              
              // ИСПРАВЛЕНО: Удален оператор return fallbackResponse, который прерывал выполнение функции
            } catch (fallbackError) {
              log(`[Instagram] Ошибка при резервной загрузке изображения: ${fallbackError.message}`, 'instagram');
              throw fallbackError;
            }
          } else {
            // Если это не видео или нет резервного изображения, прокидываем ошибку дальше
            throw error;
          }
        }
        
        // ИСПРАВЛЕНО: Этот блок теперь доступен, так как нет преждевременного return
        // Проверяем успешность создания контейнера
        if (!containerResponse || !containerResponse.data || !containerResponse.data.id) {
          const errorMsg = 'Не удалось создать контейнер для публикации в Instagram';
          
          log(`[Instagram] ${errorMsg}`, 'instagram');
          
          return {
            platform: 'instagram',
            status: 'failed',
            publishedAt: null,
            error: errorMsg
          };
        }
        
        // Получаем ID контейнера
        const containerId = containerResponse.data.id;
        
        log(`[Instagram] Этап 2 - публикация контейнера ${containerId}`, 'instagram');
        
        // Формируем URL запроса для публикации
        const publishUrl = `${baseUrl}/${businessAccountId}/media_publish`;
        
        // Подготавливаем параметры запроса
        const publishParams = {
          creation_id: containerId,
          access_token: token
        };
        
        // Отправляем запрос на публикацию с механизмом повторных попыток
        let publishResponse;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            publishResponse = await axios.post(
              publishUrl, 
              publishParams, 
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
              }
            );
            
            // Если запрос успешный, прерываем цикл
            if (publishResponse && publishResponse.data && publishResponse.data.id) {
              log(`[Instagram] Успешная публикация с попытки #${retryCount + 1}`, 'instagram');
              break;
            }
            
            // Если запрос прошел, но без ID медиа - это ошибка
            log(`[Instagram] Ответ не содержит ID медиа, повторная попытка #${retryCount + 1}`, 'instagram');
            retryCount++;
            
            if (retryCount < maxRetries) {
              // Увеличиваем время ожидания с каждой попыткой
              const waitTime = 3000 * (retryCount + 1);
              log(`[Instagram] Ожидание ${waitTime}мс перед следующей попыткой...`, 'instagram');
              await sleep(waitTime);
            }
          } catch (error: any) {
            log(`[Instagram] Ошибка публикации (попытка ${retryCount + 1}): ${error.message}`, 'instagram');
            
            // Проверяем тип ошибки - если это "Object with ID does not exist", это может быть временная ошибка
            const isTemporaryError = error.response?.data?.error?.message?.includes('Object with ID') || 
                                    error.message?.includes('Object with ID');
            
            if (isTemporaryError) {
              log(`[Instagram] Обнаружена временная ошибка API, повторная попытка #${retryCount + 1}`, 'instagram');
              retryCount++;
              
              if (retryCount < maxRetries) {
                // Увеличиваем время ожидания с каждой попыткой
                const waitTime = 5000 * (retryCount + 1);
                log(`[Instagram] Ожидание ${waitTime}мс перед следующей попыткой...`, 'instagram');
                await sleep(waitTime);
              }
            } else {
              // Если это не временная ошибка, прекращаем попытки
              log(`[Instagram] Критическая ошибка, прекращение попыток: ${error.message}`, 'instagram');
              throw error;
            }
          }
        }
        
        // Если после всех попыток нет успеха
        if (!publishResponse || !publishResponse.data) {
          throw new Error(`Не удалось опубликовать пост в Instagram после ${maxRetries} попыток`);
        }
        
        log(`[Instagram] Ответ API (публикация): ${JSON.stringify(publishResponse.data)}`, 'instagram');
        
        // Проверяем успешность публикации
        if (!publishResponse.data || !publishResponse.data.id) {
          const errorMsg = publishResponse.data.error ? 
            `${publishResponse.data.error.code}: ${publishResponse.data.error.message}` : 
            'Неизвестная ошибка при публикации';
          
          log(`[Instagram] Ошибка при публикации: ${errorMsg}`, 'instagram');
          
          return {
            platform: 'instagram',
            status: 'failed',
            publishedAt: null,
            error: errorMsg
          };
        }
        
        // Получаем ID публикации
        const igMediaId = publishResponse.data.id;
        
        // Для получения permalink нужен отдельный запрос
        log(`[Instagram] Этап 3 - получение постоянной ссылки для ${igMediaId}`, 'instagram');
        
        // Формируем URL запроса для получения информации о публикации
        const mediaInfoUrl = `${baseUrl}/${igMediaId}`;
        
        // Отправляем запрос
        const mediaInfoResponse = await axios.get(`${mediaInfoUrl}`, {
          params: {
            fields: 'permalink',
            access_token: token
          },
          timeout: 30000
        });
        
        log(`[Instagram] Ответ API (получение информации): ${JSON.stringify(mediaInfoResponse.data)}`, 'instagram');
        
        // Проверяем успешность получения информации
        let postUrl = '';
        
        if (mediaInfoResponse.data && mediaInfoResponse.data.permalink) {
          postUrl = mediaInfoResponse.data.permalink;
          log(`[Instagram] Получена постоянная ссылка: ${postUrl}`, 'instagram');
        } else {
          // Если не удалось получить permalink, создаём ссылку из ID медиа
          // ID медиа имеет формат: {business_account_id}_{media_id}
          // Для URL нам нужна только вторая часть
          const shortMediaId = String(igMediaId).includes('_') ? 
            igMediaId.split('_')[1] : igMediaId;
          
          // Если ID имеет короткий формат IG, используем его, иначе создаем альтернативную ссылку
          if (/^[A-Za-z0-9_-]{11}$/.test(shortMediaId)) {
            postUrl = `https://www.instagram.com/p/${shortMediaId}/`;
          } else {
            // Альтернативный метод создания ссылки - на основе имени бизнес-аккаунта
            const accountName = instagramSettings.businessAccountName || 
                              (instagramSettings.businessAccountId ? 
                               instagramSettings.businessAccountId.toString() : 'instagram');
            postUrl = `https://www.instagram.com/${accountName}/`;
            log(`[Instagram] Не удалось создать прямую ссылку на пост, используем ссылку на профиль: ${postUrl}`, 'instagram');
          }
            
          log(`[Instagram] Не удалось получить permalink, создаём постоянную ссылку из ID: ${postUrl}`, 'instagram');
        }
        
        // Записываем postUrl и для использования через "Опубликовать сейчас"
        try {
          // Создаем директорию логов синхронно
          const logDir = '/home/runner/workspace/logs/instagram';
          if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
            log(`[Instagram] Создана директория логов: ${logDir}`, 'instagram');
          }
          
          const logData = {
            publishedAt: new Date().toISOString(),
            contentId: content.id,
            igMediaId: igMediaId,
            permalink: postUrl
          };
          
          // Используем синхронную запись для упрощения обработки ошибок
          const logFilePath = `${logDir}/post_${content.id.substring(0, 8)}_${Date.now()}.json`;
          fs.writeFileSync(
            logFilePath, 
            JSON.stringify(logData, null, 2), 
            'utf8'
          );
          
          log(`[Instagram] Сохранен лог успешной публикации: ${logFilePath}`, 'instagram');
        } catch (logError) {
          // Ошибка логирования не должна прерывать успешную публикацию
          log(`[Instagram] Ошибка сохранения лога: ${logError.message}`, 'instagram');
        }
        
        log(`[Instagram] Публикация успешно завершена!`, 'instagram');
        
        return {
          platform: 'instagram',
          status: 'published',
          publishedAt: new Date(),
          postUrl: postUrl
        };
      } catch (error: any) {
        log(`[Instagram] Исключение при публикации: ${error.message}`, 'instagram');
        
        // Дополнительное логирование для ответа API
        if (error.response && error.response.data) {
          log(`[Instagram] Детали ошибки API: ${JSON.stringify(error.response.data)}`, 'instagram');
        }
        
        // Обработка распространенных ошибок
        let errorMessage = `Ошибка при публикации в Instagram: ${error.message}`;
        
        if (error.response?.data?.error) {
          const apiError = error.response.data.error;
          
          if (apiError.code === 190) {
            errorMessage = 'Недействительный токен доступа. Пожалуйста, обновите токен в настройках.';
          } else if (apiError.code === 4) {
            errorMessage = 'Ограничение частоты запросов. Пожалуйста, повторите попытку позже.';
          } else if (apiError.code === 10) {
            errorMessage = 'Ошибка разрешений API. Проверьте, что приложение имеет необходимые разрешения.';
          } else {
            errorMessage = `Ошибка API Instagram: ${apiError.message} (код ${apiError.code})`;
          }
        }
        
        return {
          platform: 'instagram',
          status: 'failed',
          publishedAt: null,
          error: errorMessage
        };
      }
    } catch (error: any) {
      log(`[Instagram] Общая ошибка при публикации: ${error.message}`, 'instagram');
      
      return {
        platform: 'instagram',
        status: 'failed',
        publishedAt: null,
        error: `Общая ошибка при публикации: ${error.message}`
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
    if (platform !== 'instagram') {
      return {
        platform: platform, 
        status: 'failed',
        publishedAt: null,
        error: 'Неподдерживаемая платформа для Instagram-сервиса'
      };
    }

    // Проверяем наличие настроек и логируем их для дебага
    const instagramSettings = settings.instagram || { token: null, accessToken: null, businessAccountId: null };
    const hasToken = Boolean(instagramSettings.token);
    const hasBusinessAccountId = Boolean(instagramSettings.businessAccountId);
    
    log(`[Instagram] Настройки: Token: ${hasToken ? 'задан' : 'отсутствует'}, Business Account ID: ${hasBusinessAccountId ? 'задан' : 'отсутствует'}`, 'instagram');

    if (!hasToken || !hasBusinessAccountId) {
      return {
        platform: 'instagram',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Instagram (токен или ID бизнес-аккаунта). Убедитесь, что настройки заданы в кампании.'
      };
    }

    // Проверка на undefined для избежания ошибки типизации
    if (!settings.instagram) {
      return {
        platform: 'instagram',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для Instagram'
      };
    }
    
    return this.publishToInstagram(content, settings.instagram);
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const instagramService = new InstagramService();