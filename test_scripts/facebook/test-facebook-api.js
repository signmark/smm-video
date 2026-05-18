/**
 * Скрипт для тестирования прямого доступа к Facebook API
 * 
 * Этот скрипт проверяет возможность публикации текстового поста на странице Facebook
 * используя токен доступа, минуя Directus API
 */

const axios = require('axios');

// Тестовые данные
const ACCESS_TOKEN = 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R';
const PAGE_ID = '2120362494678794';
const API_VERSION = 'v19.0';

async function testFacebookApi() {
  console.log('Тестирование Facebook API...');
  
  try {
    // Шаг 1: Проверка прав токена
    console.log('Шаг 1: Проверка прав токена...');
    const permissionsUrl = `https://graph.facebook.com/${API_VERSION}/me/permissions`;
    const permissionsResponse = await axios.get(permissionsUrl, {
      params: { access_token: ACCESS_TOKEN }
    });
    
    console.log('Разрешения токена:', JSON.stringify(permissionsResponse.data, null, 2));
    
    // Шаг 2: Получение списка страниц
    console.log('\nШаг 2: Получение списка доступных страниц...');
    const pagesUrl = `https://graph.facebook.com/${API_VERSION}/me/accounts`;
    const pagesResponse = await axios.get(pagesUrl, {
      params: { access_token: ACCESS_TOKEN }
    });
    
    console.log('Доступные страницы:', JSON.stringify(pagesResponse.data, null, 2));
    
    // Находим токен страницы
    let pageAccessToken = ACCESS_TOKEN;
    const pages = pagesResponse.data.data || [];
    
    for (const page of pages) {
      if (page.id === PAGE_ID) {
        pageAccessToken = page.access_token;
        console.log(`Найден токен для страницы ${PAGE_ID}`);
        break;
      }
    }
    
    // Шаг 3: Публикация тестового поста
    console.log('\nШаг 3: Публикация тестового поста...');
    
    const postData = new URLSearchParams();
    postData.append('message', 'Тестовый пост через Facebook Graph API v19.0 от ' + new Date().toISOString());
    postData.append('access_token', pageAccessToken);
    
    const postUrl = `https://graph.facebook.com/${API_VERSION}/${PAGE_ID}/feed`;
    console.log('URL запроса:', postUrl);
    
    const postResponse = await axios.post(postUrl, postData);
    
    console.log('Ответ API:', JSON.stringify(postResponse.data, null, 2));
    console.log('Пост успешно опубликован!');
    
    // Получаем ссылку на опубликованный пост
    const postId = postResponse.data.id;
    const permalink = `https://facebook.com/${PAGE_ID}/posts/${postId}`;
    
    console.log('Ссылка на пост:', permalink);
    
  } catch (error) {
    console.error('Ошибка при тестировании Facebook API:', error.message);
    
    if (error.response) {
      console.error('Детали ошибки API:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Запускаем тест
testFacebookApi();