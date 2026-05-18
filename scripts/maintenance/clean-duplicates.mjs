/**
 * Скрипт для удаления дубликатов и постов без social_platforms из Directus
 * Использует прямую авторизацию через email/password
 */

import axios from 'axios';
import fs from 'fs';

// Логирование в файл и консоль
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}`;
  console.log(logMessage);
  fs.appendFileSync('clean-duplicates.log', logMessage + '\n');
}

// Авторизация в Directus через email/password
async function authenticate() {
  try {
    log('Попытка авторизации в Directus...');
    const response = await axios({
      method: 'post',
      url: 'http://localhost:5000/api/auth/login', // Используем локальный сервер
      data: {
        email: 'lbrspb@gmail.com',
        password: 'qtpZ3dh7'
      }
    });

    if (response.data && response.data.token) {
      log('Авторизация успешна');
      return response.data.token;
    } else {
      log('Ошибка: Неожиданный ответ от API при авторизации');
      log(JSON.stringify(response.data));
      return null;
    }
  } catch (error) {
    log(`Ошибка авторизации: ${error.message}`);
    if (error.response) {
      log(`Код ошибки: ${error.response.status}`);
      log(`Ответ API: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Получение всех постов для кампании
async function getAllPosts(token, campaignId = '46868c44-c6a4-4bed-accf-9ad07bba790e') {
  try {
    log(`Получение всех постов для кампании ${campaignId}...`);
    const response = await axios({
      method: 'get',
      url: 'http://localhost:5000/api/campaign-content',
      params: {
        campaignId: campaignId
      },
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.data && response.data.data) {
      log(`Получено ${response.data.data.length} постов`);
      return response.data.data;
    } else {
      log('Ошибка: Неожиданный ответ от API при получении постов');
      log(JSON.stringify(response.data));
      return [];
    }
  } catch (error) {
    log(`Ошибка получения постов: ${error.message}`);
    if (error.response) {
      log(`Код ошибки: ${error.response.status}`);
      log(`Ответ API: ${JSON.stringify(error.response.data)}`);
    }
    return [];
  }
}

// Фильтрация постов без social_platforms
function filterPostsWithoutSocialPlatforms(posts) {
  log('Фильтрация постов без social_platforms...');
  return posts.filter(post => {
    // Проверяем наличие поля social_platforms
    if (!post.social_platforms) {
      return true; // Пост без social_platforms
    }
    
    // Проверяем, пустое ли поле social_platforms
    try {
      const socialPlatforms = typeof post.social_platforms === 'string' 
        ? JSON.parse(post.social_platforms) 
        : post.social_platforms;
        
      return !socialPlatforms || Object.keys(socialPlatforms).length === 0;
    } catch (e) {
      log(`Ошибка парсинга social_platforms для поста ${post.id}: ${e.message}`);
      return false;
    }
  });
}

// Поиск дубликатов на основе даты публикации
function findDuplicates(posts) {
  log('Поиск дубликатов...');
  
  // Группируем посты по дате публикации
  const postsByDate = {};
  
  posts.forEach(post => {
    if (post.scheduled_at) {
      const dateKey = new Date(post.scheduled_at).toISOString().split('T')[0]; // Только дата, без времени
      if (!postsByDate[dateKey]) {
        postsByDate[dateKey] = [];
      }
      postsByDate[dateKey].push(post);
    }
  });
  
  // Находим даты с дубликатами
  const duplicates = [];
  
  for (const date in postsByDate) {
    if (postsByDate[date].length > 1) {
      // Сортируем по дате создания (более старые в начало)
      const sortedPosts = postsByDate[date].sort((a, b) => {
        return new Date(a.date_created) - new Date(b.date_created);
      });
      
      // Сохраняем первый пост (самый старый) и помечаем остальные как дубликаты
      for (let i = 1; i < sortedPosts.length; i++) {
        duplicates.push(sortedPosts[i]);
      }
    }
  }
  
  log(`Найдено ${duplicates.length} дубликатов`);
  return duplicates;
}

// Удаление поста
async function deletePost(token, postId) {
  try {
    log(`Удаление поста ${postId}...`);
    const response = await axios({
      method: 'delete',
      url: `http://localhost:5000/api/campaign-content/${postId}`,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    log(`Пост ${postId} успешно удален`);
    return true;
  } catch (error) {
    log(`Ошибка удаления поста ${postId}: ${error.message}`);
    if (error.response) {
      log(`Код ошибки: ${error.response.status}`);
      log(`Ответ API: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

// Основная функция
async function main() {
  // Создаем или очищаем файл лога
  fs.writeFileSync('clean-duplicates.log', '');
  
  log('Начало очистки дубликатов и постов без social_platforms');
  
  // Авторизация
  const token = await authenticate();
  if (!token) {
    log('Не удалось авторизоваться. Остановка скрипта.');
    return;
  }
  
  // Получение всех постов
  const posts = await getAllPosts(token);
  if (posts.length === 0) {
    log('Не удалось получить посты. Остановка скрипта.');
    return;
  }
  
  // Фильтрация постов без social_platforms
  const postsWithoutSocialPlatforms = filterPostsWithoutSocialPlatforms(posts);
  log(`Найдено ${postsWithoutSocialPlatforms.length} постов без social_platforms`);
  
  // Поиск дубликатов
  const duplicates = findDuplicates(posts);
  
  // Объединяем посты на удаление
  const postsToDelete = [...postsWithoutSocialPlatforms, ...duplicates];
  const uniquePostsToDelete = Array.from(new Set(postsToDelete.map(p => p.id)))
    .map(id => postsToDelete.find(p => p.id === id));
  
  log(`Всего на удаление: ${uniquePostsToDelete.length} постов`);
  
  // Запрос подтверждения перед удалением
  log('Посты, которые будут удалены:');
  uniquePostsToDelete.forEach(post => {
    log(`ID: ${post.id}, Название: ${post.title}, Дата: ${post.scheduled_at || 'Не задана'}`);
  });
  
  // Удаление постов
  let deletedCount = 0;
  for (const post of uniquePostsToDelete) {
    const success = await deletePost(token, post.id);
    if (success) {
      deletedCount++;
    }
    
    // Небольшая задержка между запросами, чтобы не перегружать API
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  log(`Удаление завершено. Удалено ${deletedCount} из ${uniquePostsToDelete.length} постов.`);
}

// Запуск скрипта
main().catch(error => {
  log(`Необработанная ошибка: ${error.message}`);
  log(error.stack);
});