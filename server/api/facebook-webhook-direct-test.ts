import { Router } from 'express';
import axios from 'axios';
import log from '../utils/logger';
import { URLSearchParams } from 'url';

const router = Router();

/**
 * Упрощенный тестовый маршрут для прямой публикации в Facebook
 * Игнорирует данные Directus и просто публикует тестовый пост напрямую в Facebook
 */
router.post('/', async (req, res) => {
  try {
    log.info('[Facebook Direct Test] Начало тестовой публикации в Facebook');
    
    // Хардкодим данные для публикации
    const ACCESS_TOKEN = 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R';
    const PAGE_ID = '2120362494678794';
    const API_VERSION = 'v19.0';
    
    // Шаг 1: Проверка прав токена и получение токена страницы
    log.info('[Facebook Direct Test] Получение токена страницы');
    const pageAccessToken = await getPageAccessToken(ACCESS_TOKEN, PAGE_ID, API_VERSION);
    
    // Шаг 2: Публикация тестового поста
    log.info('[Facebook Direct Test] Публикация тестового поста');
    const postResult = await publishTestPost(pageAccessToken, PAGE_ID, API_VERSION);
    
    return res.json({
      success: true,
      message: 'Тестовый пост успешно опубликован в Facebook',
      postId: postResult.id,
      permalink: postResult.permalink
    });
    
  } catch (error: any) {
    log.error(`[Facebook Direct Test] Ошибка публикации: ${error.message}`);
    
    if (error.response?.data) {
      log.error(`[Facebook Direct Test] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    return res.status(500).json({
      success: false,
      error: `Ошибка при тестовой публикации в Facebook: ${error.message}`
    });
  }
});

/**
 * Получает токен страницы для публикации от имени страницы
 */
async function getPageAccessToken(userAccessToken: string, pageId: string, apiVersion: string): Promise<string> {
  log.info('[Facebook Direct Test] Получение списка страниц');
  const pagesUrl = `https://graph.facebook.com/${apiVersion}/me/accounts`;
  const pagesResponse = await axios.get(pagesUrl, {
    params: { access_token: userAccessToken }
  });
  
  log.info(`[Facebook Direct Test] Получено ${pagesResponse.data.data?.length || 0} страниц`);
  
  // Находим нужную страницу и получаем её токен
  let pageAccessToken = userAccessToken;
  const pages = pagesResponse.data.data || [];
  
  for (const page of pages) {
    if (page.id === pageId) {
      pageAccessToken = page.access_token;
      log.info(`[Facebook Direct Test] Найден токен для страницы ${pageId}`);
      break;
    }
  }
  
  return pageAccessToken;
}

/**
 * Публикует тестовый пост на странице Facebook
 */
async function publishTestPost(pageAccessToken: string, pageId: string, apiVersion: string): Promise<{ id: string, permalink: string }> {
  const postData = new URLSearchParams();
  postData.append('message', `Тестовый пост через API Facebook от ${new Date().toISOString()}`);
  postData.append('access_token', pageAccessToken);
  
  const postUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/feed`;
  log.info(`[Facebook Direct Test] Отправка запроса на публикацию: ${postUrl}`);
  
  const response = await axios.post(postUrl, postData);
  log.info(`[Facebook Direct Test] Ответ API: ${JSON.stringify(response.data)}`);
  
  const postId = response.data.id;
  const permalink = `https://facebook.com/${pageId}/posts/${postId}`;
  
  return { id: postId, permalink };
}

export default router;