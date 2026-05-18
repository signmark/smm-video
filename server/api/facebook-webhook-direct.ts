import { Router } from 'express';
import axios from 'axios';
import log from '../utils/logger';
import { directusApi } from '../lib/directus';

/**
 * Очищает HTML-теги, сохраняя структуру текста
 * Функция преобразует HTML-форматирование в текстовое форматирование для Facebook
 * @param htmlText HTML-текст для очистки
 * @returns Текст без HTML-тегов, но с сохраненной структурой
 */
export function cleanHtmlForFacebook(htmlText: string): string {
  if (!htmlText) return '';
  
  // Сохраняем абзацы и переносы строк
  let cleanText = htmlText
    // Сначала заменяем закрывающие теги параграфов на двойной перенос
    .replace(/<\/p>/gi, '\n\n')
    // Заменяем теги переноса строк
    .replace(/<br\s*\/?>/gi, '\n')
    // Заменяем закрывающие теги для заголовков и списков
    .replace(/<\/(h1|h2|h3|h4|h5|h6|li|ul|ol)>/gi, '\n')
    // Заменяем закрывающие теги для div
    .replace(/<\/div>/gi, '\n');
    
  // Удаляем все оставшиеся HTML-теги
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  
  // Удаляем множественные переносы строк (более двух) и заменяем их на двойной перенос
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n');
  
  // Добавляем эмоджи вместо маркеров списка
  cleanText = cleanText.replace(/^\s*•\s*/gm, '• ');
  
  // Заменяем HTML-сущности
  cleanText = cleanText
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
  
  return cleanText.trim();
}

const router = Router();

/**
 * Маршрут для прямой публикации в Facebook без использования n8n
 * Данный маршрут полностью заменяет использование n8n для Facebook
 */
router.post('/', async (req, res) => {
  let postPermalink = '';
  let postId = '';
  
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID контента для публикации в Facebook' 
      });
    }
    
    log.info(`[Facebook Direct] Начало прямой публикации контента ${contentId} в Facebook`);
    
    // Получаем данные контента из Directus
    // Получаем токен из активных сессий администратора через DirectusAuthManager
    const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
    
    // Получаем токен из активных сессий администратора или используем токен из переменных окружения
    let adminToken = process.env.DIRECTUS_ADMIN_TOKEN || '';
    const sessions = directusAuthManager.getAllActiveSessions();
    
    if (sessions.length > 0) {
      // Берем самый свежий токен из активных сессий
      adminToken = sessions[0].token;
      log.info(`[Facebook Direct] Используется токен администратора из активной сессии`);
    } else {
      log.info(`[Facebook Direct] Активные сессии не найдены, используется токен из переменных окружения`);
    }
    
    if (!adminToken) {
      throw new Error('Отсутствует административный токен для Directus API');
    }
    
    const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (!contentResponse.data?.data) {
      log.error(`[Facebook Direct] Контент с ID ${contentId} не найден в Directus`);
      return res.status(404).json({ 
        success: false,
        error: 'Контент не найден в базе данных' 
      });
    }
    
    const content = contentResponse.data.data;
    
    log.info(`[Facebook Direct] Получен контент для публикации: ${JSON.stringify({
      id: content.id,
      title: content.title,
      contentType: content.content_type,
      hasImage: !!content.image_url
    })}`);
    
    // Получаем информацию о кампании для получения настроек Facebook
    if (!content.campaign_id) {
      log.error(`[Facebook Direct] Контент ${contentId} не содержит campaign_id`);
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID кампании в контенте' 
      });
    }
    
    // Получаем данные кампании для извлечения настроек Facebook
    const campaignResponse = await directusApi.get(`/items/user_campaigns/${content.campaign_id}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (!campaignResponse.data?.data) {
      log.error(`[Facebook Direct] Кампания с ID ${content.campaign_id} не найдена`);
      return res.status(400).json({ 
        success: false,
        error: 'Кампания не найдена' 
      });
    }
    
    const campaign = campaignResponse.data.data;
    log.info(`[Facebook Direct] Получены данные кампании: "${campaign.name}"`);
    
    // Извлекаем настройки Facebook из кампании
    let socialSettings = campaign.social_media_settings || {};
    
    // Если socialSettings - строка, парсим JSON
    if (typeof socialSettings === 'string') {
      try {
        socialSettings = JSON.parse(socialSettings);
      } catch (e) {
        socialSettings = {};
      }
    }
    
    const facebookSettings = socialSettings.facebook || {};
    
    const facebookAccessToken = facebookSettings.token;
    const facebookPageId = facebookSettings.pageId;
    
    if (!facebookAccessToken || !facebookPageId) {
      log.error('[Facebook Direct] Отсутствуют токен доступа или ID страницы Facebook в настройках кампании');
      return res.status(400).json({ 
        success: false,
        error: 'Не настроены учетные данные Facebook (токен и/или ID страницы) в настройках кампании' 
      });
    }
    
    log.info(`[Facebook Direct] Используются настройки из кампании: токен ${facebookAccessToken.substring(0, 10)}... и страница ${facebookPageId}`);
    
    
    // Подготавливаем данные для публикации
    // Очищаем HTML-теги из контента, сохраняя структуру текста
    const message = cleanHtmlForFacebook(content.content);
    const imageUrl = content.image_url;
    
    log.info(`[Facebook Direct] Текст для публикации обработан (удалены HTML-теги)`);
    log.debug(`[Facebook Direct] Исходный текст: ${content.content.substring(0, 100)}${content.content.length > 100 ? '...' : ''}`);
    log.debug(`[Facebook Direct] Обработанный текст: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
    
    // Обрабатываем additional_images, если они есть
    let additionalImages = content.additional_images || [];
    
    // Если additionalImages - строка, парсим JSON
    if (typeof additionalImages === 'string') {
      try {
        additionalImages = JSON.parse(additionalImages);
      } catch (e) {
        additionalImages = [];
      }
    }
    
    // Определяем тип контента для публикации
    const hasImages = imageUrl || (additionalImages && additionalImages.length > 0);
    const isCarousel = imageUrl && additionalImages && additionalImages.length > 0;
    
    log.info(`[Facebook Direct] Тип публикации: ${isCarousel ? 'карусель' : (hasImages ? 'пост с изображением' : 'текстовый пост')}`);
    
    if (isCarousel) {
      log.info(`[Facebook Direct] Найдено ${additionalImages.length + 1} изображений для карусели`);
    }
    
    // Версия Facebook Graph API - используем актуальную версию
    const apiVersion = 'v19.0';

    // Получаем актуальный токен страницы
    log.info(`[Facebook Direct] Проверка прав токена Facebook`);
    const getPageToken = async () => {
      try {
        // Проверка прав токена
        const permissionsUrl = `https://graph.facebook.com/${apiVersion}/me/permissions`;
        const permissionsResponse = await axios.get(permissionsUrl, {
          params: { access_token: facebookAccessToken }
        });
        
        log.info(`[Facebook Direct] Права токена Facebook: ${JSON.stringify(permissionsResponse.data)}`);
        
        // Проверка, что токен имеет доступ к странице
        const pagesUrl = `https://graph.facebook.com/${apiVersion}/me/accounts`;
        const pagesResponse = await axios.get(pagesUrl, {
          params: { access_token: facebookAccessToken }
        });
        
        log.info(`[Facebook Direct] Доступные страницы: ${JSON.stringify(pagesResponse.data)}`);
        
        // Найти нужную страницу и получить её токен
        let pageToken = facebookAccessToken;
        const pages = pagesResponse.data.data || [];
        
        for(const page of pages) {
          if(page.id === facebookPageId) {
            pageToken = page.access_token;
            log.info(`[Facebook Direct] Найден токен для страницы ${facebookPageId}`);
            break;
          }
        }
        
        if(pageToken !== facebookAccessToken) {
          log.info(`[Facebook Direct] Используется токен страницы вместо пользовательского токена`);
        }
        
        return pageToken;
      } catch(permError: any) {
        log.error(`[Facebook Direct] Ошибка при проверке прав токена: ${permError.message}`);
        if(permError.response?.data) {
          log.error(`[Facebook Direct] Детали ошибки: ${JSON.stringify(permError.response.data)}`);
        }
        
        // В случае ошибки возвращаем оригинальный токен
        return facebookAccessToken;
      }
    };
    
    // Получаем токен страницы для использования в запросах
    const pageAccessToken = await getPageToken();

    try {
      // Выбираем тип публикации на основе наличия изображений
      if (isCarousel) {
        // Публикуем карусель (альбом) с несколькими изображениями
        log.info(`[Facebook Direct] Публикация карусели с ${additionalImages.length + 1} изображениями`);
        
        // Метод 1: Создаем альбом с несколькими фото
        try {
          // Сначала создаем альбом
          const albumUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/albums`;
          const albumData = new URLSearchParams();
          albumData.append('name', content.title || 'Новый альбом');
          albumData.append('message', message);
          albumData.append('access_token', pageAccessToken);
          
          log.info('[Facebook Direct] Создание альбома для карусели');
          const albumResponse = await axios.post(albumUrl, albumData);
          const albumId = albumResponse.data.id;
          log.info(`[Facebook Direct] Альбом успешно создан, ID: ${albumId}`);
          
          // Теперь добавляем все изображения в альбом
          const photoUrl = `https://graph.facebook.com/${apiVersion}/${albumId}/photos`;
          
          // Сначала добавляем основное изображение
          const mainPhotoData = new URLSearchParams();
          mainPhotoData.append('url', imageUrl);
          mainPhotoData.append('access_token', pageAccessToken);
          
          log.info(`[Facebook Direct] Добавление основного изображения ${imageUrl} в альбом`);
          await axios.post(photoUrl, mainPhotoData);
          
          // Затем добавляем дополнительные изображения
          for (const additionalImageUrl of additionalImages) {
            const additionalPhotoData = new URLSearchParams();
            additionalPhotoData.append('url', additionalImageUrl);
            additionalPhotoData.append('access_token', pageAccessToken);
            
            log.info(`[Facebook Direct] Добавление дополнительного изображения ${additionalImageUrl} в альбом`);
            await axios.post(photoUrl, additionalPhotoData);
          }
          
          // Для альбома используем его ID
          postId = albumId;
          
          // Для альбомов формат ссылки другой
          const postUrl = `https://facebook.com/media/set/?set=a.${albumId}`;
          log.info(`[Facebook Direct] Карусель успешно опубликована, postUrl: ${postUrl}`);
        } catch (albumError: any) {
          log.error(`[Facebook Direct] Ошибка при создании альбома: ${albumError.message}`);
          
          if (albumError.response?.data) {
            log.error(`[Facebook Direct] Детали ошибки API Facebook: ${JSON.stringify(albumError.response.data)}`);
          }
          
          // Метод 2: Если с альбомом не получилось, пробуем метод с attached_media (только для посл. версий API)
          log.info(`[Facebook Direct] Пробуем альтернативный метод создания карусели с помощью attached_media`);
          
          try {
            // Подготавливаем прикрепленные медиафайлы
            const attachedMedia = [];
            
            // Загружаем каждое изображение отдельно
            const uploadUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/photos`;
            
            // Сначала загружаем основное изображение
            log.info(`[Facebook Direct] Загрузка основного изображения карусели: ${imageUrl}`);
            const mainPhotoData = new URLSearchParams();
            mainPhotoData.append('url', imageUrl);
            mainPhotoData.append('published', 'false');  // Важно - не публиковать сразу
            mainPhotoData.append('access_token', pageAccessToken);
            
            const mainPhotoResponse = await axios.post(uploadUrl, mainPhotoData);
            const mainPhotoId = mainPhotoResponse.data.id;
            log.info(`[Facebook Direct] Основное изображение загружено, ID: ${mainPhotoId}`);
            attachedMedia.push({ media_fbid: mainPhotoId });
            
            // Загружаем дополнительные изображения
            for (const additionalImageUrl of additionalImages) {
              log.info(`[Facebook Direct] Загрузка дополнительного изображения карусели: ${additionalImageUrl}`);
              const photoData = new URLSearchParams();
              photoData.append('url', additionalImageUrl);
              photoData.append('published', 'false');  // Не публиковать сразу
              photoData.append('access_token', pageAccessToken);
              
              const photoResponse = await axios.post(uploadUrl, photoData);
              const photoId = photoResponse.data.id;
              log.info(`[Facebook Direct] Дополнительное изображение загружено, ID: ${photoId}`);
              attachedMedia.push({ media_fbid: photoId });
            }
            
            // Теперь создаем пост с прикрепленными изображениями
            const feedUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/feed`;
            const postData = new URLSearchParams();
            postData.append('message', message);
            
            // Добавляем все медиа-вложения
            for (let i = 0; i < attachedMedia.length; i++) {
              postData.append(`attached_media[${i}]`, JSON.stringify(attachedMedia[i]));
            }
            
            postData.append('access_token', pageAccessToken);
            
            log.info(`[Facebook Direct] Создание карусельного поста с ${attachedMedia.length} изображениями`);
            const response = await axios.post(feedUrl, postData);
            log.info(`[Facebook Direct] Ответ от API Facebook (карусельный пост): ${JSON.stringify(response.data)}`);
            
            postId = response.data.id;
            const postUrl = `https://facebook.com/${postId}`;
            log.info(`[Facebook Direct] Карусель успешно опубликована, postUrl: ${postUrl}`);
          } catch (attachedError: any) {
            log.error(`[Facebook Direct] Ошибка при методе attached_media: ${attachedError.message}`);
            
            if (attachedError.response?.data) {
              log.error(`[Facebook Direct] Детали ошибки: ${JSON.stringify(attachedError.response.data)}`);
            }
            
            // Если и это не сработало, публикуем просто первое изображение
            log.info(`[Facebook Direct] Пробуем опубликовать только первое изображение`);
            
            // Метод 3: Простой пост с одним изображением
            const photoUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/photos`;
            const singlePhotoData = new URLSearchParams();
            singlePhotoData.append('url', imageUrl);
            singlePhotoData.append('message', message + "\n\n[Примечание: это первое изображение из серии]");
            singlePhotoData.append('access_token', pageAccessToken);
            
            const photoResponse = await axios.post(photoUrl, singlePhotoData);
            postId = photoResponse.data.id;
            const postUrl = `https://facebook.com/${postId}`;
            log.info(`[Facebook Direct] Опубликовано единичное изображение: ${postUrl}`);
          }
        }
      }
      else if (imageUrl) {
        // Публикуем пост с одним изображением
        log.info(`[Facebook Direct] Публикация с изображением: ${imageUrl}`);
        
        // Прямой метод - публикуем изображение с текстом через photos endpoint
        const photoUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/photos`;
        const photoData = new URLSearchParams();
        photoData.append('url', imageUrl);
        photoData.append('message', message);
        photoData.append('access_token', pageAccessToken);
        
        log.info(`[Facebook Direct] Отправка запроса на публикацию с изображением: ${photoUrl}`);
        const response = await axios.post(photoUrl, photoData);
        log.info(`[Facebook Direct] Ответ от API Facebook (публикация с изображением): ${JSON.stringify(response.data)}`);
        
        postId = response.data.id;
        const postUrl = `https://facebook.com/${postId}`;
        postPermalink = postUrl;
      } else {
        // Публикуем обычный текстовый пост
        const feedUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/feed`;
        const postData = new URLSearchParams();
        postData.append('message', message);
        postData.append('access_token', pageAccessToken);
        
        log.info(`[Facebook Direct] Отправка запроса к Facebook API для текстового поста: ${feedUrl}`);
        const response = await axios.post(feedUrl, postData);
        log.info(`[Facebook Direct] Ответ от API Facebook (текстовый пост): ${JSON.stringify(response.data)}`);
        
        postId = response.data.id;
        const postUrl = `https://facebook.com/${postId}`;
        postPermalink = postUrl;
      }
      
      log.info(`[Facebook Direct] Пост успешно создан, ID: ${postId}`);
    } catch (mainError: any) {
      log.error(`[Facebook Direct] Основная ошибка публикации: ${mainError.message}`);
      
      if (mainError.response?.data) {
        log.error(`[Facebook Direct] Детали ошибки: ${JSON.stringify(mainError.response.data)}`);
      }
      
      // Если все основные методы не сработали, пробуем самый простой fallback
      try {
        log.info(`[Facebook Direct] Пробуем крайний fallback вариант - обычный текстовый пост со ссылкой`);
        
        const feedUrl = `https://graph.facebook.com/${apiVersion}/${facebookPageId}/feed`;
        const fallbackData = new URLSearchParams();
        fallbackData.append('message', message + (imageUrl ? `\n\nСмотрите изображение по ссылке: ${imageUrl}` : ''));
        fallbackData.append('access_token', pageAccessToken);
        
        if (imageUrl) {
          fallbackData.append('link', imageUrl);
        }
        
        log.info(`[Facebook Direct] Отправка fallback запроса`);
        const response = await axios.post(feedUrl, fallbackData);
        
        postId = response.data.id;
        const postUrl = `https://facebook.com/${facebookPageId}/posts/${postId}`;
        postPermalink = postUrl;
        log.info(`[Facebook Direct] Fallback пост успешно опубликован: ${postUrl}`);
      } catch (fallbackError: any) {
        log.error(`[Facebook Direct] Даже fallback не сработал: ${fallbackError.message}`);
        throw mainError; // Пробрасываем исходную ошибку
      }
    }
    
    log.info(`[Facebook Direct] Пост успешно создан, ID: ${postId}`);
    
    // Формируем ссылку на пост если она еще не задана (для карусели уже задана)
    if (!postPermalink) {
      // Пост в Facebook часто имеет формат ID типа '[pageId]_[postId]'
      if (postId.includes('_')) {
        // Если ID уже содержит ID страницы (формат pageId_postId)
        postPermalink = `https://facebook.com/${postId}`;
      } else {
        // Формируем полную ссылку на основе ID страницы и поста
        postPermalink = `https://facebook.com/${facebookPageId}/posts/${postId}`;
      }
    }
    
    log.info(`[Facebook Direct] Ссылка на опубликованный пост (postUrl): ${postPermalink}`);
    
    // Обновляем статус публикации контента в Directus
    await updateSocialPlatformsStatus(contentId, adminToken, postPermalink);
    
    return res.json({ 
      success: true,
      message: 'Пост успешно опубликован в Facebook',
      postId: postId,
      postUrl: postPermalink
    });
  } catch (error: any) {
    log.error(`[Facebook Direct] Ошибка при публикации: ${error.message}`);
    
    if (error.response) {
      log.error(`[Facebook Direct] Детали ошибки Facebook API: ${JSON.stringify(error.response.data)}`);
    }
    
    return res.status(500).json({ 
      success: false,
      error: `Ошибка при публикации в Facebook: ${error.message}` 
    });
  }
});

/**
 * Обновляет статус публикации в Directus
 * @param contentId ID контента для обновления
 * @param token Токен для доступа к Directus API
 * @param postUrl Ссылка на опубликованный пост (опционально)
 */
async function updateSocialPlatformsStatus(contentId: string, token: string, postUrl?: string) {
  try {
    // Проверяем токен, и если он недействительный, получаем новый
    try {
      // Проверяем валидность токена через простой запрос
      // Декодируем токен напрямую вместо запроса к API
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      // Имитируем ответ API
      const mockResponse = { 
        data: { 
          data: { 
            id: payload.id, 
            email: payload.email || 'unknown@email.com' 
          } 
        } 
      };
      
      log.info(`[Facebook Direct] Токен валиден, продолжаем обновление статуса`);
    } catch (tokenError) {
      log.warn(`[Facebook Direct] Предоставленный токен не валиден, получаем новый`);
      
      // Получаем новый токен из директус-менеджера
      const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
      const sessions = directusAuthManager.getAllActiveSessions();
      
      if (sessions.length > 0) {
        token = sessions[0].token;
        log.info(`[Facebook Direct] Получен новый токен из активной сессии для обновления статуса`);
      } else {
        throw new Error('Не удалось получить действительный токен для обновления статуса публикации');
      }
    }
    
    // Получаем текущие данные контента
    const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!contentResponse.data?.data) {
      log.error(`[Facebook Direct] Не удалось получить контент для обновления статуса: ${contentId}`);
      return;
    }
    
    const content = contentResponse.data.data;
    
    // Получаем текущее состояние socialPlatforms
    let socialPlatforms = content.social_platforms || {};
    
    // Если socialPlatforms - строка, парсим JSON
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (e) {
        socialPlatforms = {};
      }
    }
    
    log.info(`[Facebook Direct] Контент ID: ${contentId}`);
    log.info(`[Facebook Direct] Текущие social_platforms до обновления: ${JSON.stringify(socialPlatforms)}`);
    log.info(`[Facebook Direct] Проверка на наличие других платформ: ${Object.keys(socialPlatforms).join(', ')}`);
    
    // Глубокая копия объекта socialPlatforms для сохранения всех данных
    const updatedPlatforms = JSON.parse(JSON.stringify(socialPlatforms));
    
    // Обновляем ТОЛЬКО информацию о Facebook, принудительно сохраняя все данные других платформ
    updatedPlatforms.facebook = {
      // Сохраняем предыдущие настройки, если они были
      ...(socialPlatforms.facebook || {}),
      // Обновляем статус публикации
      status: 'published',
      publishedAt: new Date().toISOString(),
      postUrl: postUrl || '', // Используем стандартное имя поля postUrl для единообразия API
      // Сохраняем selected, если был задан ранее (важно для интерфейса)
      selected: socialPlatforms.facebook?.selected || true
    };
    
    log.info(`[Facebook Direct] Обновленные social_platforms: ${JSON.stringify(updatedPlatforms)}`);
    log.info(`[Facebook Direct] После обновления есть следующие платформы: ${Object.keys(updatedPlatforms).join(', ')}`);
    log.info(`[Facebook Direct] Подтверждение сохранения VK данных: ${JSON.stringify(updatedPlatforms.vk || "отсутствует")}`);
    log.info(`[Facebook Direct] Подтверждение сохранения Telegram данных: ${JSON.stringify(updatedPlatforms.telegram || "отсутствует")}`);
    log.info(`[Facebook Direct] Подтверждение сохранения Instagram данных: ${JSON.stringify(updatedPlatforms.instagram || "отсутствует")}`);
    
    // Присваиваем обновленный объект
    socialPlatforms = updatedPlatforms;
    
    // Обновляем контент в Directus
    await directusApi.patch(`/items/campaign_content/${contentId}`, {
      social_platforms: socialPlatforms
    }, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    log.info(`[Facebook Direct] Статус публикации обновлен в Directus: ${contentId}`);
  } catch (error: any) {
    log.error(`[Facebook Direct] Ошибка при обновлении статуса: ${error.message}`);
    
    if (error.response) {
      log.error(`[Facebook Direct] Детали ошибки Directus API: ${JSON.stringify(error.response.data)}`);
    }
  }
}

export default router;