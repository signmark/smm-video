import { Router } from 'express';
import axios from 'axios';
import log from '../utils/logger';
import { directusApi } from '../lib/directus';
import { URLSearchParams } from 'url';
import { directusAuthManager } from '../services/directus-auth-manager';
import { directusCrud } from '../services/directus-crud';

const router = Router();

/**
 * Маршрут для прямой публикации в Facebook без использования n8n
 * Улучшенная версия с более надежной обработкой авторизации и ошибок
 */
router.post('/', async (req, res) => {
  let postUrl = '';
  let postId = '';
  
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ 
        success: false,
        error: 'Не указан ID контента для публикации в Facebook' 
      });
    }
    
    log.info(`[Facebook v3] Начало публикации контента ${contentId} в Facebook`);
    
    // Шаг 1: Получаем действующий токен для работы с Directus
    log.info(`[Facebook v3] Получение действующего токена администратора`);
    
    // Пытаемся авторизоваться с учетными данными из переменных окружения
    let adminToken;
    
    try {
      // Проверяем, есть ли активные сессии
      const sessions = directusAuthManager.getAllActiveSessions();
      
      if (sessions.length > 0) {
        adminToken = sessions[0].token;
        log.info(`[Facebook v3] Используем существующую сессию администратора`);
      } else {
        // Если активных сессий нет, авторизуемся заново
        log.info(`[Facebook v3] Активных сессий не найдено, авторизуемся заново`);
        
        // Получаем учетные данные из переменных окружения
        const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
        const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
        
        if (!adminEmail || !adminPassword) {
          throw new Error('Отсутствуют учетные данные администратора в переменных окружения');
        }
        
        // Авторизуемся в Directus через directusCrud
        log.info(`[Facebook v3] Авторизация администратора с учетными данными из env`);
        
        // Используем нативный axios для авторизации, так как мы не можем использовать directusCrud.login напрямую
        const directusUrl = process.env.DIRECTUS_URL;
        const loginResponse = await axios.post(`${directusUrl}/auth/login`, {
          email: adminEmail,
          password: adminPassword
        });
        
        if (!loginResponse.data.data.access_token) {
          throw new Error('Не удалось авторизоваться в Directus API');
        }
        
        adminToken = loginResponse.data.data.access_token;
        directusAuthManager.addAdminSession({
          id: loginResponse.data.data.user.id,
          token: adminToken,
          email: adminEmail
        });
        
        log.info(`[Facebook v3] Успешная авторизация администратора`);
      }
    } catch (authError: any) {
      log.error(`[Facebook v3] Ошибка авторизации в Directus: ${authError.message}`);
      return res.status(500).json({
        success: false,
        error: `Ошибка авторизации в Directus: ${authError.message}`
      });
    }
    
    if (!adminToken) {
      return res.status(401).json({
        success: false,
        error: 'Не удалось получить токен для доступа к Directus API'
      });
    }
    
    // Шаг 2: Получаем данные контента из Directus
    log.info(`[Facebook v3] Получение данных контента ${contentId}`);
    
    let content;
    try {
      // Используем прямой запрос к Directus API, так как не можем использовать directusCrud.read напрямую
      const directusUrl = process.env.DIRECTUS_URL;
      const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      if (!contentResponse.data?.data) {
        log.error(`[Facebook v3] Контент с ID ${contentId} не найден`);
        return res.status(404).json({
          success: false,
          error: 'Контент не найден в базе данных'
        });
      }
      
      content = contentResponse.data.data;
      
      log.info(`[Facebook v3] Получен контент: ${JSON.stringify({
        id: content.id,
        title: content.title,
        contentType: content.content_type,
        hasImage: !!content.image_url
      })}`);
    } catch (contentError: any) {
      log.error(`[Facebook v3] Ошибка получения контента: ${contentError.message}`);
      
      if (contentError.response?.data) {
        log.error(`[Facebook v3] Детали ошибки Directus API: ${JSON.stringify(contentError.response.data)}`);
      }
      
      return res.status(500).json({
        success: false,
        error: `Ошибка получения контента: ${contentError.message}`
      });
    }
    
    // Шаг 3: Получаем данные кампании из Directus
    if (!content.campaign_id) {
      return res.status(400).json({
        success: false,
        error: 'Не указан ID кампании в контенте'
      });
    }
    
    log.info(`[Facebook v3] Получение данных кампании ${content.campaign_id}`);
    
    let campaign;
    try {
      // Используем прямой запрос к Directus API
      const directusUrl = process.env.DIRECTUS_URL;
      const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${content.campaign_id}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      if (!campaignResponse.data?.data) {
        log.error(`[Facebook v3] Кампания с ID ${content.campaign_id} не найдена`);
        return res.status(404).json({
          success: false,
          error: 'Кампания не найдена в базе данных'
        });
      }
      
      campaign = campaignResponse.data.data;
      log.info(`[Facebook v3] Получены данные кампании: "${campaign.name}"`);
    } catch (campaignError: any) {
      log.error(`[Facebook v3] Ошибка получения кампании: ${campaignError.message}`);
      
      if (campaignError.response?.data) {
        log.error(`[Facebook v3] Детали ошибки Directus API: ${JSON.stringify(campaignError.response.data)}`);
      }
      
      return res.status(500).json({
        success: false,
        error: `Ошибка получения кампании: ${campaignError.message}`
      });
    }
    
    // Шаг 4: Извлекаем настройки Facebook из кампании
    let userAccessToken = '';
    let pageId = '';
    
    log.info(`[Facebook v3] Извлечение настроек Facebook`);
    
    // Проверяем наличие настроек Facebook в различных полях
    if (campaign?.settings?.facebook) {
      userAccessToken = campaign.settings.facebook.token || '';
      pageId = campaign.settings.facebook.pageId || '';
      log.info('[Facebook v3] Использованы настройки из settings.facebook');
    } else if (campaign?.social_media_settings?.facebook) {
      userAccessToken = campaign.social_media_settings.facebook.token || '';
      pageId = campaign.social_media_settings.facebook.pageId || '';
      log.info('[Facebook v3] Использованы настройки из social_media_settings.facebook');
    } else {
      // Фоллбэк на переменные окружения
      userAccessToken = process.env.FACEBOOK_ACCESS_TOKEN || '';
      pageId = process.env.FACEBOOK_PAGE_ID || '';
      log.info('[Facebook v3] Использованы настройки из переменных окружения');
    }
    
    // Проверяем, что получены обязательные параметры
    if (!userAccessToken || !pageId) {
      log.error('[Facebook v3] Отсутствуют токен или ID страницы Facebook');
      return res.status(400).json({
        success: false,
        error: 'Не настроены учетные данные Facebook (токен и/или ID страницы)'
      });
    }
    
    log.info(`[Facebook v3] Настройки Facebook получены: токен ${userAccessToken.substring(0, 10)}... и страница ${pageId}`);
    
    // Шаг 5: Подготавливаем контент для публикации
    const message = content.content.replace(/<[^>]*>/g, ''); // Удаляем HTML-разметку
    const imageUrl = content.image_url;
    const videoUrl = content.video_url;
    
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
    
    // Если additionalImages не массив, конвертируем в массив
    if (!Array.isArray(additionalImages)) {
      additionalImages = additionalImages ? [additionalImages] : [];
    }
    
    // Определяем тип контента для публикации
    const hasImages = imageUrl || (additionalImages && additionalImages.length > 0);
    const isCarousel = imageUrl && additionalImages && additionalImages.length > 0;
    const hasVideo = videoUrl ? true : false;
    
    // Определяем тип публикации для логирования
    let publicationType = 'текстовый пост';
    if (isCarousel) publicationType = 'карусель';
    else if (hasVideo) publicationType = 'видео';
    else if (hasImages) publicationType = 'пост с изображением';
    
    log.info(`[Facebook v3] Тип публикации: ${publicationType}`);
    
    const apiVersion = 'v19.0';
    
    // Шаг 6: Публикуем контент в Facebook
    try {
      // Получаем токен страницы для публикации от имени страницы
      log.info(`[Facebook v3] Получение токена страницы`);
      
      const pageAccessToken = await getPageAccessToken(userAccessToken, pageId, apiVersion);
      
      // Публикуем контент в зависимости от его типа
      if (isCarousel) {
        // Публикуем карусель как альбом
        log.info(`[Facebook v3] Публикация карусели (${additionalImages.length + 1} изображений)`);
        
        const carouselResult = await publishCarousel(
          apiVersion, 
          pageId, 
          pageAccessToken, 
          message, 
          imageUrl, 
          additionalImages, 
          content.title || 'Новый альбом'
        );
        
        postId = carouselResult.id;
        postUrl = carouselResult.postUrl;
      } else if (hasVideo && videoUrl) {
        // Публикуем пост с видео
        log.info(`[Facebook v3] Публикация поста с видео: ${videoUrl}`);
        
        const videoResult = await publishVideoPost(
          apiVersion,
          pageId,
          pageAccessToken,
          message,
          videoUrl,
          content.title || undefined
        );
        
        postId = videoResult.id;
        postUrl = videoResult.postUrl;
      } else if (imageUrl) {
        // Публикуем пост с одним изображением
        log.info(`[Facebook v3] Публикация поста с изображением`);
        
        const imageResult = await publishImagePost(
          apiVersion,
          pageId,
          pageAccessToken,
          message,
          imageUrl
        );
        
        postId = imageResult.id;
        postUrl = imageResult.postUrl;
      } else {
        // Публикуем обычный текстовый пост
        log.info(`[Facebook v3] Публикация текстового поста`);
        
        const textResult = await publishTextPost(
          apiVersion,
          pageId,
          pageAccessToken,
          message
        );
        
        postId = textResult.id;
        postUrl = textResult.postUrl;
      }
      
      log.info(`[Facebook v3] Пост успешно опубликован: ID=${postId}, URL=${postUrl}`);
    } catch (publishError: any) {
      log.error(`[Facebook v3] Ошибка при публикации: ${publishError.message}`);
      
      if (publishError.response?.data) {
        log.error(`[Facebook v3] Детали ошибки API: ${JSON.stringify(publishError.response.data)}`);
      }
      
      // Если основная публикация не удалась, пробуем опубликовать текстовый пост
      log.info(`[Facebook v3] Пробуем запасной вариант - текстовый пост`);
      
      try {
        let fallbackMessage = message;
        
        if (imageUrl) {
          fallbackMessage += `\n\nИзображение: ${imageUrl}`;
        }
        
        if (additionalImages && additionalImages.length > 0) {
          fallbackMessage += `\n\nДополнительные изображения:\n${additionalImages.join('\n')}`;
        }
        
        const apiVersion = 'v19.0';
        const pageAccessToken = await getPageAccessToken(userAccessToken, pageId, apiVersion);
        
        const fallbackResult = await publishTextPost(
          apiVersion,
          pageId,
          pageAccessToken,
          fallbackMessage
        );
        
        postId = fallbackResult.id;
        postUrl = fallbackResult.postUrl;
        
        log.info(`[Facebook v3] Запасной вариант успешно опубликован: ID=${postId}`);
      } catch (fallbackError: any) {
        log.error(`[Facebook v3] Ошибка при публикации запасного варианта: ${fallbackError.message}`);
        return res.status(500).json({
          success: false,
          error: `Не удалось опубликовать контент в Facebook: ${publishError.message}`
        });
      }
    }
    
    // Шаг 7: Обновляем статус публикации в Directus
    log.info(`[Facebook v3] Обновление статуса публикации в Directus`);
    
    try {
      await updatePublicationStatus(contentId, adminToken, postUrl);
      log.info(`[Facebook v3] Статус публикации успешно обновлен`);
    } catch (updateError: any) {
      log.error(`[Facebook v3] Ошибка при обновлении статуса: ${updateError.message}`);
      // Не прерываем выполнение, так как основная публикация уже выполнена
    }
    
    return res.json({
      success: true,
      message: 'Пост успешно опубликован в Facebook',
      postId: postId,
      postUrl: postUrl
    });
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка публикации: ${error.message}`);
    
    if (error.response) {
      log.error(`[Facebook v3] Детали ошибки: ${JSON.stringify(error.response.data || {})}`);
    }
    
    return res.status(500).json({
      success: false,
      error: `Ошибка при публикации в Facebook: ${error.message}`
    });
  }
});

/**
 * Получает токен страницы для публикации от имени страницы
 */
async function getPageAccessToken(userAccessToken: string, pageId: string, apiVersion: string): Promise<string> {
  try {
    // Проверяем, что у токена есть нужные права
    const permissionsUrl = `https://graph.facebook.com/${apiVersion}/me/permissions`;
    const permissionsResponse = await axios.get(permissionsUrl, {
      params: { access_token: userAccessToken }
    });
    
    log.info(`[Facebook v3] Права токена Facebook: ${JSON.stringify(permissionsResponse.data)}`);
    
    // Получаем список страниц, к которым у пользователя есть доступ
    const pagesUrl = `https://graph.facebook.com/${apiVersion}/me/accounts`;
    const pagesResponse = await axios.get(pagesUrl, {
      params: { access_token: userAccessToken }
    });
    
    // Находим нужную страницу и получаем её токен
    const pages = pagesResponse.data.data || [];
    log.info(`[Facebook v3] Получено ${pages.length} страниц`);
    
    let pageAccessToken = userAccessToken;
    
    for (const page of pages) {
      if (page.id === pageId) {
        pageAccessToken = page.access_token;
        log.info(`[Facebook v3] Найден токен для страницы ${pageId}`);
        break;
      }
    }
    
    if (pageAccessToken !== userAccessToken) {
      log.info(`[Facebook v3] Будет использован токен страницы вместо токена пользователя`);
    } else {
      log.warn(`[Facebook v3] Не найден токен для страницы ${pageId}, используем токен пользователя`);
    }
    
    return pageAccessToken;
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при получении токена страницы: ${error.message}`);
    // В случае ошибки возвращаем исходный токен
    return userAccessToken;
  }
}

/**
 * Публикует карусель как альбом Facebook
 */
async function publishCarousel(
  apiVersion: string,
  pageId: string,
  pageAccessToken: string,
  message: string,
  imageUrl: string,
  additionalImages: string[],
  title: string
): Promise<{ id: string, postUrl: string }> {
  try {
    // Создаем альбом
    const albumUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/albums`;
    const albumData = new URLSearchParams();
    albumData.append('name', title);
    albumData.append('message', message);
    albumData.append('access_token', pageAccessToken);
    
    const albumResponse = await axios.post(albumUrl, albumData);
    const albumId = albumResponse.data.id;
    log.info(`[Facebook v3] Альбом успешно создан, ID: ${albumId}`);
    
    // Добавляем изображения в альбом
    const photoUrl = `https://graph.facebook.com/${apiVersion}/${albumId}/photos`;
    
    // Добавляем основное изображение
    const mainPhotoData = new URLSearchParams();
    mainPhotoData.append('url', imageUrl);
    mainPhotoData.append('access_token', pageAccessToken);
    
    await axios.post(photoUrl, mainPhotoData);
    log.info('[Facebook v3] Основное изображение добавлено в альбом');
    
    // Добавляем дополнительные изображения
    for (const additionalImageUrl of additionalImages) {
      const additionalPhotoData = new URLSearchParams();
      additionalPhotoData.append('url', additionalImageUrl);
      additionalPhotoData.append('access_token', pageAccessToken);
      
      await axios.post(photoUrl, additionalPhotoData);
      log.info('[Facebook v3] Дополнительное изображение добавлено в альбом');
    }
    
    // Формируем ссылку на альбом
    const postUrl = `https://facebook.com/media/set/?set=a.${albumId}`;
    
    return { id: albumId, postUrl };
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при создании карусели: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook v3] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    throw error;
  }
}

/**
 * Публикует пост с одним изображением
 */
async function publishImagePost(
  apiVersion: string,
  pageId: string,
  pageAccessToken: string,
  message: string,
  imageUrl: string
): Promise<{ id: string, postUrl: string }> {
  try {
    // Публикуем изображение с сообщением
    const apiUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/photos`;
    const postData = new URLSearchParams();
    postData.append('url', imageUrl);
    postData.append('message', message);
    postData.append('access_token', pageAccessToken);
    
    const response = await axios.post(apiUrl, postData);
    const postId = response.data.id;
    
    log.info(`[Facebook v3] Изображение успешно опубликовано, ID: ${postId}`);
    
    // Формируем ссылку на пост
    const postUrl = `https://facebook.com/${postId}`;
    
    return { id: postId, postUrl };
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при публикации изображения: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook v3] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    throw error;
  }
}

/**
 * Публикует текстовый пост
 */
async function publishTextPost(
  apiVersion: string,
  pageId: string,
  pageAccessToken: string,
  message: string
): Promise<{ id: string, postUrl: string }> {
  try {
    // Публикуем текстовый пост
    const apiUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/feed`;
    const postData = new URLSearchParams();
    postData.append('message', message);
    postData.append('access_token', pageAccessToken);
    
    const response = await axios.post(apiUrl, postData);
    const postId = response.data.id;
    
    log.info(`[Facebook v3] Текстовый пост успешно опубликован, ID: ${postId}`);
    
    // Формируем ссылку на пост
    const postUrl = `https://facebook.com/${pageId}/posts/${postId}`;
    
    return { id: postId, postUrl };
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при публикации текстового поста: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook v3] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    throw error;
  }
}

/**
 * Публикует видео в Facebook
 */
async function publishVideoPost(
  apiVersion: string,
  pageId: string,
  pageAccessToken: string,
  message: string,
  videoUrl: string,
  title?: string
): Promise<{ id: string, postUrl: string }> {
  try {
    log.info(`[Facebook v3] Публикация видео: ${videoUrl}`);
    
    // Публикуем видео
    const videoApiUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/videos`;
    const postData = new URLSearchParams();
    postData.append('file_url', videoUrl);
    postData.append('description', message);
    
    if (title) {
      postData.append('title', title);
    }
    
    postData.append('access_token', pageAccessToken);
    
    log.info(`[Facebook v3] Отправка запроса на публикацию видео...`);
    const response = await axios.post(videoApiUrl, postData);
    const postId = response.data.id;
    
    log.info(`[Facebook v3] Видео успешно отправлено на публикацию, ID: ${postId}`);
    
    // Формируем ссылку на пост с видео
    const postUrl = `https://facebook.com/${pageId}/videos/${postId}`;
    
    return { id: postId, postUrl };
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при публикации видео: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook v3] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    throw error;
  }
}

/**
 * Обновляет статус публикации в Directus
 */
async function updatePublicationStatus(contentId: string, token: string, postUrl?: string) {
  try {
    // Используем прямой запрос к Directus API
    const directusUrl = process.env.DIRECTUS_URL;
    
    // Получаем текущие данные контента
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!contentResponse.data?.data) {
      throw new Error(`Не удалось получить контент ${contentId} для обновления статуса`);
    }
    
    const contentData = contentResponse.data.data;
    
    // Получаем текущее состояние social_platforms
    let socialPlatforms = contentData.social_platforms || {};
    
    // Если socialPlatforms - строка, парсим JSON
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (e) {
        log.error(`[Facebook v3] Ошибка парсинга JSON в social_platforms: ${e}`);
        socialPlatforms = {};
      }
    }
    
    // Если socialPlatforms не объект, создаем новый объект
    if (!socialPlatforms || typeof socialPlatforms !== 'object') {
      socialPlatforms = {};
    }
    
    // Обновляем статус Facebook
    socialPlatforms.facebook = {
      ...(socialPlatforms.facebook || {}),
      status: 'published',
      publishedAt: new Date().toISOString(),
      postUrl: postUrl || ''
    };
    
    // Обновляем контент в Directus через прямой PATCH запрос
    await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
      social_platforms: socialPlatforms
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    log.info(`[Facebook v3] Статус публикации обновлен: Facebook = published`);
  } catch (error: any) {
    log.error(`[Facebook v3] Ошибка при обновлении статуса: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook v3] Детали ошибки Directus API: ${JSON.stringify(error.response.data)}`);
    }
    
    throw error;
  }
}

export default router;