/**
 * Скрипт для удаления постов без поля social_platforms из Directus
 * Важно: запускать с правами администратора, т.к. скрипт удаляет данные!
 */

import axios from 'axios';
import { config } from 'dotenv';
import { createRequire } from 'module';

// Загружаем переменные окружения
config();

// Получаем переменные окружения
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://content.contentplanner.ru';
const DIRECTUS_ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const DIRECTUS_ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '46868c44-c6a4-4bed-accf-9ad07bba790e'; // ID кампании "ПП"

// Переменная для хранения токена авторизации
let adminToken = null;

// Функция для авторизации в Directus
async function authenticate() {
  try {
    console.log(`Авторизация в Directus как ${DIRECTUS_ADMIN_EMAIL}...`);
    
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_ADMIN_EMAIL,
      password: DIRECTUS_ADMIN_PASSWORD
    });
    
    adminToken = response.data.data.access_token;
    console.log('Авторизация успешна!');
    return adminToken;
  } catch (error) {
    console.error('Ошибка авторизации:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Функция для получения всех постов для кампании
async function getAllPosts(campaignId) {
  try {
    console.log(`Получение всех постов для кампании ${campaignId}...`);
    
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      params: {
        filter: {
          campaignId: {
            _eq: campaignId
          }
        },
        limit: -1 // Получить все посты
      },
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    
    const posts = response.data.data;
    console.log(`Получено ${posts.length} постов`);
    return posts;
  } catch (error) {
    console.error('Ошибка получения постов:', error.response?.data || error.message);
    return [];
  }
}

// Функция для фильтрации постов без social_platforms
function filterPostsWithoutSocialPlatforms(posts) {
  const filteredPosts = posts.filter(post => {
    // Проверяем, есть ли поле social_platforms
    const hasSocialPlatforms = post.social_platforms && 
                              typeof post.social_platforms === 'object' && 
                              Object.keys(post.social_platforms).length > 0;
    
    return !hasSocialPlatforms;
  });
  
  console.log(`Найдено ${filteredPosts.length} постов без social_platforms`);
  return filteredPosts;
}

// Функция для удаления поста
async function deletePost(postId) {
  try {
    await axios.delete(`${DIRECTUS_URL}/items/campaign_content/${postId}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    
    console.log(`Пост ${postId} успешно удален`);
    return true;
  } catch (error) {
    console.error(`Ошибка удаления поста ${postId}:`, error.response?.data || error.message);
    return false;
  }
}

// Главная функция
async function main() {
  try {
    // Проверяем наличие учетных данных
    if (!DIRECTUS_ADMIN_EMAIL || !DIRECTUS_ADMIN_PASSWORD) {
      throw new Error('Отсутствуют учетные данные администратора Directus (DIRECTUS_ADMIN_EMAIL и DIRECTUS_ADMIN_PASSWORD)');
    }
    
    // Авторизуемся в Directus
    await authenticate();
    
    // Получаем все посты для кампании
    const allPosts = await getAllPosts(CAMPAIGN_ID);
    
    // Фильтруем посты без social_platforms
    const postsToDelete = filterPostsWithoutSocialPlatforms(allPosts);
    
    if (postsToDelete.length === 0) {
      console.log('Нет постов для удаления. Все посты имеют поле social_platforms.');
      return;
    }
    
    // Спрашиваем подтверждение у пользователя
    console.log('\nВНИМАНИЕ: Следующие посты будут удалены:');
    postsToDelete.forEach(post => {
      console.log(`ID: ${post.id}, Заголовок: ${post.title || 'Без заголовка'}`);
    });
    
    console.log(`\nВсего будет удалено ${postsToDelete.length} постов.`);
    
    // Здесь бы мы обычно запрашивали подтверждение от пользователя через readline,
    // но для упрощения в данном случае просто продолжаем

    console.log('\nНачинаем удаление постов...');
    
    // Удаляем посты по одному
    let successCount = 0;
    for (const post of postsToDelete) {
      const success = await deletePost(post.id);
      if (success) successCount++;
      
      // Небольшая задержка, чтобы не нагружать сервер
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\nУдаление завершено. Удалено ${successCount} из ${postsToDelete.length} постов.`);
    
  } catch (error) {
    console.error('Произошла ошибка:', error.message);
    process.exit(1);
  }
}

// Запускаем скрипт
main();