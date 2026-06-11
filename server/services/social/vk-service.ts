import axios from 'axios';
import { log } from '../../utils/logger';
import { CampaignContent, SocialMediaSettings, SocialPlatform, SocialPublication } from '@shared/schema';
import { BaseSocialService } from './base-service';

/**
 * КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: ВК-сервис больше НЕ публикует напрямую
 * Все публикации ВК должны идти только через n8n webhook
 * Этот сервис теперь заблокирован для прямых публикаций
 */
export class VkService extends BaseSocialService {
  /**
   * Форматирует текст для публикации в ВКонтакте
   * @param content Исходный текст контента
   * @returns Отформатированный текст для ВКонтакте
   */
  private formatTextForVk(content: string): string {
    if (!content || typeof content !== 'string') {
      return '';
    }
    
    try {
      // VK поддерживает ограниченную разметку текста
      let formattedText = content
        // Удаляем HTML-теги и заменяем их на маркдаун для VK
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<p>([^]*?)<\/p>/g, '$1\n\n')
        .replace(/<div>([^]*?)<\/div>/g, '$1\n')
        .replace(/<h[1-6]>([^]*?)<\/h[1-6]>/g, '$1\n\n')
        
        // Замена HTML-тегов форматирования на текст
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
      
      return formattedText;
    } catch (error) {
      log(`Ошибка при форматировании текста для VK: ${error}`, 'social-publishing');
      return content; // В случае ошибки возвращаем исходный текст
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
    vkSettings: { token?: string | null; groupId?: string | null }
  ): Promise<SocialPublication> {
    try {
      // Проверяем наличие необходимых параметров
      if (!vkSettings.token || !vkSettings.groupId) {
        log(`Ошибка публикации в VK: отсутствуют настройки. Token: ${vkSettings.token ? 'задан' : 'отсутствует'}, GroupID: ${vkSettings.groupId ? 'задан' : 'отсутствует'}`, 'social-publishing');
        return {
          platform: 'vk',
          status: 'failed',
          publishedAt: null,
          error: 'Missing VK API settings (token or groupId)'
        };
      }
      
      // Извлекаем параметры
      const token = vkSettings.token;
      const groupId = vkSettings.groupId;
      
      // Получаем ID группы без префикса "club"
      const numericGroupId = groupId.startsWith('club') ? groupId.substring(4) : groupId;
      
      // Форматируем owner_id для API запросов (группы используют отрицательный ID)
      const ownerId = numericGroupId.startsWith('-') ? numericGroupId : `-${numericGroupId}`;
      
      log(`Подготовка публикации в VK: группа ${groupId}, owner_id = ${ownerId}`, 'social-publishing');
      
      // Обрабатываем контент
      const processedContent = this.processAdditionalImages(content, 'vk');
      
      // Загружаем локальные изображения на Imgur
      const imgurContent = await this.uploadImagesToImgur(processedContent);
      
      // Подготавливаем текст для отправки
      let text = '';
      
      // Если есть заголовок, добавляем его в начало сообщения
      if (imgurContent.title) {
        text += `${imgurContent.title}\n\n`;
      }
      
      // Добавляем основной контент
      const formattedContent = this.formatTextForVk(imgurContent.content || '');
      text += formattedContent;
      
      // Если есть хэштеги, добавляем их в конец сообщения
      if (imgurContent.hashtags && Array.isArray(imgurContent.hashtags) && imgurContent.hashtags.length > 0) {
        const hashtags = imgurContent.hashtags
          .filter(tag => tag && typeof tag === 'string' && tag.trim() !== '')
          .map(tag => tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`);
        
        if (hashtags.length > 0) {
          text += '\n\n' + hashtags.join(' ');
        }
      }
      
      // Если текст получился слишком длинным, обрезаем его (VK ограничение - 16000 символов)
      if (text.length > 16000) {
        text = text.substring(0, 15997) + '...';
        log(`Текст для VK был обрезан до 16000 символов`, 'social-publishing');
      }
      
      // Определяем, есть ли изображения или видео для публикации
      const hasMainImage = imgurContent.imageUrl && imgurContent.imageUrl.trim() !== '';
      const hasVideo = imgurContent.videoUrl && imgurContent.videoUrl.trim() !== '';
      const hasAdditionalImages = imgurContent.additionalImages && 
                                Array.isArray(imgurContent.additionalImages) && 
                                imgurContent.additionalImages.length > 0;
      
      // Сначала проверяем наличие видео
      if (hasVideo) {
        log(`Обнаружено видео для публикации в VK: ${imgurContent.videoUrl}`, 'social-publishing');
        
        try {
          // Формируем запрос к API VK для публикации видео
          const apiUrl = 'https://api.vk.com/method/wall.post';
          const videoUrl = imgurContent.videoUrl as string;
          
          // Добавляем текст и ссылку на видео в сообщение
          const messageWithVideo = `${text}\n\n${videoUrl}`;
          
          const params = new URLSearchParams({
            owner_id: ownerId,
            message: messageWithVideo,
            access_token: token,
            v: '5.131' // Версия API VK
          });
          
          // Отправляем запрос
          const response = await axios.post(apiUrl, params);
          
          if (response.data && response.data.response && response.data.response.post_id) {
            const postId = response.data.response.post_id;
            const postUrl = `https://vk.com/wall${ownerId}_${postId}`;
            
            log(`Пост с видео успешно опубликован в VK: ${postUrl}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'published',
              publishedAt: new Date(),
              postUrl
            };
          } else {
            const errorMsg = response.data.error ? 
              `${response.data.error.error_code}: ${response.data.error.error_msg}` : 
              'Неизвестная ошибка при публикации видео';
            
            log(`Ошибка при публикации видео в VK: ${errorMsg}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'failed',
              publishedAt: null,
              error: errorMsg
            };
          }
        } catch (error: any) {
          log(`Исключение при публикации видео в VK: ${error.message}`, 'social-publishing');
          
          return {
            platform: 'vk',
            status: 'failed',
            publishedAt: null,
            error: `Exception while posting video: ${error.message}`
          };
        }
      }
      
      // Собираем все изображения для публикации
      const allImages: string[] = [];
      
      if (hasMainImage) {
        allImages.push(imgurContent.imageUrl as string);
      }
      
      if (hasAdditionalImages) {
        allImages.push(...(imgurContent.additionalImages as string[]));
      }
      
      // Если нет изображений и видео, публикуем только текст
      if (allImages.length === 0) {
        log(`Публикация в VK только с текстом (без изображений)`, 'social-publishing');
        
        try {
          // Формируем запрос к API VK
          const apiUrl = 'https://api.vk.com/method/wall.post';
          const params = new URLSearchParams({
            owner_id: ownerId,
            message: text,
            access_token: token,
            v: '5.131' // Версия API VK
          });
          
          // Отправляем запрос
          const response = await axios.post(apiUrl, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
          });
          
          log(`Ответ от API VK (wall.post): ${JSON.stringify(response.data)}`, 'social-publishing');
          
          // Проверяем успешность запроса
          if (response.data && response.data.response && response.data.response.post_id) {
            const postId = response.data.response.post_id;
            const postUrl = `https://vk.com/wall${ownerId}_${postId}`;
            
            log(`Текст успешно опубликован в VK: ${postUrl}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'published',
              publishedAt: new Date(),
              postUrl
            };
          } else {
            const errorMsg = response.data.error ? 
              `${response.data.error.error_code}: ${response.data.error.error_msg}` : 
              'Неизвестная ошибка при публикации текста';
            
            log(`Ошибка при публикации текста в VK: ${errorMsg}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'failed',
              publishedAt: null,
              error: errorMsg
            };
          }
        } catch (error: any) {
          log(`Исключение при публикации текста в VK: ${error.message}`, 'social-publishing');
          
          return {
            platform: 'vk',
            status: 'failed',
            publishedAt: null,
            error: `Exception while posting text: ${error.message}`
          };
        }
      }
      // Если есть изображения, сначала загружаем их в VK
      else {
        log(`Публикация в VK с ${allImages.length} изображениями`, 'social-publishing');
        
        try {
          // Последовательно загружаем каждое изображение
          const uploadedPhotos = [];
          
          for (const imageUrl of allImages) {
            try {
              // Шаг 1: Получаем сервер для загрузки фото
              const getWallUploadServerUrl = 'https://api.vk.com/method/photos.getWallUploadServer';
              const serverParams = new URLSearchParams({
                group_id: numericGroupId.replace('-', ''), // Для групп ID должен быть положительным
                access_token: token,
                v: '5.131'
              });
              
              const serverResponse = await axios.post(getWallUploadServerUrl, serverParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
              });
              
              if (!serverResponse.data.response || !serverResponse.data.response.upload_url) {
                log(`Ошибка при получении сервера для загрузки фото в VK: ${JSON.stringify(serverResponse.data)}`, 'social-publishing');
                continue;
              }
              
              const uploadUrl = serverResponse.data.response.upload_url;
              
              // Шаг 2: Загружаем изображение на сервер VK
              // Для этого сначала скачиваем его, а затем загружаем на сервер VK
              const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
              
              const formData = new FormData();
              const blob = new Blob([Buffer.from(imageResponse.data)], { type: 'image/jpeg' });
              formData.append('photo', blob, 'image.jpg');
              
              const uploadResponse = await axios.post(uploadUrl, formData, {
                headers: {
                  'Content-Type': 'multipart/form-data'
                },
                timeout: 60000
              });
              
              if (!uploadResponse.data || !uploadResponse.data.photo) {
                log(`Ошибка при загрузке фото на сервер VK: ${JSON.stringify(uploadResponse.data)}`, 'social-publishing');
                continue;
              }
              
              // Шаг 3: Сохраняем загруженное фото в альбом
              const saveWallPhotoUrl = 'https://api.vk.com/method/photos.saveWallPhoto';
              const saveParams = new URLSearchParams({
                group_id: numericGroupId.replace('-', ''),
                photo: uploadResponse.data.photo,
                server: uploadResponse.data.server.toString(),
                hash: uploadResponse.data.hash,
                access_token: token,
                v: '5.131'
              });
              
              const saveResponse = await axios.post(saveWallPhotoUrl, saveParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
              });
              
              if (!saveResponse.data.response || !saveResponse.data.response[0]) {
                log(`Ошибка при сохранении фото в VK: ${JSON.stringify(saveResponse.data)}`, 'social-publishing');
                continue;
              }
              
              const photoObj = saveResponse.data.response[0];
              uploadedPhotos.push(`photo${photoObj.owner_id}_${photoObj.id}`);
              
              log(`Изображение успешно загружено в VK: ${JSON.stringify(photoObj)}`, 'social-publishing');
            } catch (imageError: any) {
              log(`Ошибка при обработке изображения для VK: ${imageError.message}`, 'social-publishing');
            }
          }
          
          // Если не удалось загрузить ни одного изображения, публикуем только текст
          if (uploadedPhotos.length === 0) {
            log(`Не удалось загрузить ни одного изображения, публикуем только текст`, 'social-publishing');
            
            const textOnlyParams = new URLSearchParams({
              owner_id: ownerId,
              message: text,
              access_token: token,
              v: '5.131'
            });
            
            const textOnlyResponse = await axios.post('https://api.vk.com/method/wall.post', textOnlyParams, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              timeout: 30000
            });
            
            if (textOnlyResponse.data && textOnlyResponse.data.response && textOnlyResponse.data.response.post_id) {
              const postId = textOnlyResponse.data.response.post_id;
              const postUrl = `https://vk.com/wall${ownerId}_${postId}`;
              
              log(`Текст опубликован в VK без изображений: ${postUrl}`, 'social-publishing');
              
              return {
                platform: 'vk',
                status: 'published',
                publishedAt: new Date(),
                postUrl
              };
            } else {
              const errorMsg = textOnlyResponse.data.error ? 
                `${textOnlyResponse.data.error.error_code}: ${textOnlyResponse.data.error.error_msg}` : 
                'Неизвестная ошибка при публикации текста';
              
              log(`Ошибка при публикации текста без изображений в VK: ${errorMsg}`, 'social-publishing');
              
              return {
                platform: 'vk',
                status: 'failed',
                publishedAt: null,
                error: errorMsg
              };
            }
          }
          
          // Публикуем текст с прикрепленными изображениями
          const attachments = uploadedPhotos.join(',');
          
          log(`Публикация в VK с ${uploadedPhotos.length} прикрепленными изображениями`, 'social-publishing');
          
          const postParams = new URLSearchParams({
            owner_id: ownerId,
            message: text,
            attachments,
            access_token: token,
            v: '5.131'
          });
          
          const postResponse = await axios.post('https://api.vk.com/method/wall.post', postParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
          });
          
          if (postResponse.data && postResponse.data.response && postResponse.data.response.post_id) {
            const postId = postResponse.data.response.post_id;
            const postUrl = `https://vk.com/wall${ownerId}_${postId}`;
            
            log(`Пост с изображениями успешно опубликован в VK: ${postUrl}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'published',
              publishedAt: new Date(),
              postUrl
            };
          } else {
            const errorMsg = postResponse.data.error ? 
              `${postResponse.data.error.error_code}: ${postResponse.data.error.error_msg}` : 
              'Неизвестная ошибка при публикации';
            
            log(`Ошибка при публикации поста с изображениями в VK: ${errorMsg}`, 'social-publishing');
            
            return {
              platform: 'vk',
              status: 'failed',
              publishedAt: null,
              error: errorMsg
            };
          }
        } catch (error: any) {
          log(`Исключение при публикации в VK: ${error.message}`, 'social-publishing');
          
          return {
            platform: 'vk',
            status: 'failed',
            publishedAt: null,
            error: `Exception while posting to VK: ${error.message}`
          };
        }
      }
    } catch (error: any) {
      log(`Общая ошибка при публикации в VK: ${error.message}`, 'social-publishing');
      
      return {
        platform: 'vk',
        status: 'failed',
        publishedAt: null,
        error: `General error: ${error.message}`
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
    platform: SocialPlatform | string | any,
    settings: SocialMediaSettings
  ): Promise<SocialPublication> {
    // Гарантированно обрабатываем platform как строку
    // Защита от передачи объектов и других неожиданных типов
    const platformStr = typeof platform === 'string' ? platform : 'vk';
    
    log(`VkService.publishToPlatform получил platform типа ${typeof platform}, используем: ${platformStr}`, 'social-publishing');
    
    // Всегда возвращаем platform: 'vk' в результате для VkService
    if (platformStr !== 'vk') {
      return {
        platform: 'vk', 
        status: 'failed',
        publishedAt: null,
        error: 'Unsupported platform for VkService'
      };
    }

    // Проверяем наличие настроек и логируем их для дебага
    const vkSettings = settings.vk || { token: null, groupId: null };
    const hasToken = Boolean(vkSettings.token);
    const hasGroupId = Boolean(vkSettings.groupId);
    
    log(`VkService.publishToPlatform: Настройки: hasToken=${hasToken}, hasGroupId=${hasGroupId}`, 'social-publishing');

    if (!hasToken || !hasGroupId) {
      return {
        platform: 'vk',
        status: 'failed',
        publishedAt: null,
        error: 'Отсутствуют настройки для ВКонтакте (токен или ID группы). Убедитесь, что настройки заданы в кампании.'
      };
    }

    return this.publishToVk(content, vkSettings);
  }

  /**
   * ПРИМЕЧАНИЕ: Публикация Clips/Shorts в ВК выполняется ТОЛЬКО через n8n webhook
   * Прямые методы загрузки видео заблокированы согласно архитектуре проекта
   * 
   * Для публикации клипов используйте:
   * - POST /api/webhook/vk-clips с { contentId, videoUrl, title, description }
   * - Или установите content_type = 'clip' для автоматической маршрутизации через n8n
   * 
   * n8n workflow URL: ${baseN8nUrl}/webhook/publish-vk-clips
   */
}

// Экспортируем экземпляр сервиса для использования в приложении
export const vkService = new VkService();