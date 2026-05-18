// Скрипт для удаления постов без поля social_platforms из Directus
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

// Загружаем переменные окружения
dotenv.config();

// Константы
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://content.contentplanner.ru';
const DIRECTUS_ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const DIRECTUS_ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e'; // ID кампании "ПП"

// Для логирования
const LOG_FILE = './delete-posts.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  
  console.log(message);
  fs.appendFileSync(LOG_FILE, logMessage);
}

// Получаем токен администратора Directus
async function getAdminToken() {
  if (DIRECTUS_ADMIN_TOKEN) {
    log('Использую токен администратора из переменных окружения');
    return DIRECTUS_ADMIN_TOKEN;
  }
  
  try {
    log(`Авторизация в Directus как ${DIRECTUS_ADMIN_EMAIL}...`);
    
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_ADMIN_EMAIL,
      password: DIRECTUS_ADMIN_PASSWORD
    });
    
    log('Авторизация успешна!');
    return response.data.data.access_token;
  } catch (error) {
    log(`Ошибка авторизации: ${error.message}`);
    
    if (error.response?.data) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    process.exit(1);
  }
}

// Получаем все элементы контента для заданной кампании
async function getCampaignContent(token) {
  try {
    log(`Получение контента для кампании ${CAMPAIGN_ID}...`);
    
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      params: {
        filter: {
          campaign_id: {
            _eq: CAMPAIGN_ID
          }
        },
        limit: -1
      },
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    const content = response.data.data;
    log(`Получено ${content.length} элементов контента`);
    return content;
  } catch (error) {
    log(`Ошибка получения контента: ${error.message}`);
    
    if (error.response?.data) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    return [];
  }
}

// Фильтруем контент без social_platforms
function filterContentWithoutSocialPlatforms(contentList) {
  const filteredContent = contentList.filter(content => {
    return !content.social_platforms || 
           typeof content.social_platforms !== 'object' || 
           Object.keys(content.social_platforms).length === 0;
  });
  
  log(`Найдено ${filteredContent.length} элементов без social_platforms`);
  return filteredContent;
}

// Удаляем контент
async function deleteContent(contentId, token) {
  try {
    log(`Удаление контента ${contentId}...`);
    
    await axios.delete(`${DIRECTUS_URL}/items/campaign_content/${contentId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    log(`Контент ${contentId} успешно удален`);
    return true;
  } catch (error) {
    log(`Ошибка удаления контента ${contentId}: ${error.message}`);
    
    if (error.response?.data) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    return false;
  }
}

// Запускаем главную функцию
async function main() {
  log('=== НАЧИНАЮ ПРОЦЕСС ОЧИСТКИ КОНТЕНТА ===');
  
  try {
    // Получаем токен администратора
    const token = await getAdminToken();
    
    // Получаем весь контент кампании
    const allContent = await getCampaignContent(token);
    
    if (!allContent.length) {
      log('Нет контента для обработки');
      return;
    }
    
    // Фильтруем контент без social_platforms
    const contentToDelete = filterContentWithoutSocialPlatforms(allContent);
    
    if (!contentToDelete.length) {
      log('Нет контента для удаления');
      return;
    }
    
    // Выводим список контента для удаления
    log('\nСписок контента для удаления:');
    contentToDelete.forEach((content, index) => {
      log(`${index + 1}. ID: ${content.id}, Заголовок: ${content.title || 'Без заголовка'}`);
    });
    
    log(`\nВсего для удаления: ${contentToDelete.length} элементов`);
    
    // Удаляем контент
    log('\nНачинаю процесс удаления...');
    let successCount = 0;
    
    for (const content of contentToDelete) {
      const success = await deleteContent(content.id, token);
      if (success) successCount++;
      
      // Делаем небольшую паузу между запросами
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    log(`\nПроцесс удаления завершен. Удалено ${successCount} из ${contentToDelete.length} элементов`);
  } catch (error) {
    log(`Произошла ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Запускаем скрипт
main();