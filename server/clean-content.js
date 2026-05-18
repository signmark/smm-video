/**
 * Серверный скрипт для очистки базы от постов без social_platforms
 * Использует внутренний доступ к API и базе данных
 */

import { config } from 'dotenv';
import axios from 'axios';
import { storage } from './storage.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Загружаем переменные окружения
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ID кампании "ПП"
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';

// Получаем учетные данные администратора из .env
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://content.contentplanner.ru';
const DIRECTUS_ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const DIRECTUS_ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

// Для логирования
const logFilePath = path.join(__dirname, 'content-cleanup.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  
  console.log(message);
  fs.appendFileSync(logFilePath, logMessage);
}

// Функция для получения токена администратора
async function getAdminToken() {
  // Если есть токен в .env, используем его
  if (DIRECTUS_ADMIN_TOKEN) {
    log('Использую токен администратора из .env');
    return DIRECTUS_ADMIN_TOKEN;
  }
  
  try {
    log(`Авторизация в Directus как ${DIRECTUS_ADMIN_EMAIL}...`);
    
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_ADMIN_EMAIL,
      password: DIRECTUS_ADMIN_PASSWORD
    });
    
    const token = response.data.data.access_token;
    log('Авторизация успешна!');
    return token;
  } catch (error) {
    log(`Ошибка авторизации: ${error.message}`);
    
    if (error.response?.data) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    // Пробуем получить токен из системы
    log('Пытаюсь получить токен администратора из серверной системы...');
    return getServerAdminToken();
  }
}

// Получение токена администратора из серверного хранилища
async function getServerAdminToken() {
  try {
    // Получаем токен напрямую из хранилища
    const userId = '53921f16-f51d-4591-80b9-8caa4fde4d13'; // ID админа
    const tokenInfo = await storage.getUserTokenInfo(userId);
    
    if (tokenInfo && tokenInfo.token) {
      log('Получен токен администратора из хранилища!');
      return tokenInfo.token;
    }
    
    throw new Error('Не удалось получить токен из хранилища');
  } catch (error) {
    log(`Ошибка получения токена из хранилища: ${error.message}`);
    process.exit(1);
  }
}

// Функция для получения всего контента кампании
async function getCampaignContent(token) {
  try {
    log(`Получение контента для кампании ${CAMPAIGN_ID}...`);
    
    // Получаем контент через API storage
    const campaignContent = await storage.getCampaignContent(null, CAMPAIGN_ID);
    
    log(`Получено ${campaignContent.length} элементов контента`);
    return campaignContent;
  } catch (error) {
    log(`Ошибка получения контента: ${error.message}`);
    return [];
  }
}

// Функция для фильтрации контента без social_platforms
function filterContentWithoutSocialPlatforms(contentList) {
  const filteredContent = contentList.filter(content => {
    // Проверяем отсутствие поля social_platforms или его пустоту
    return !content.socialPlatforms || 
           typeof content.socialPlatforms !== 'object' || 
           Object.keys(content.socialPlatforms).length === 0;
  });
  
  log(`Найдено ${filteredContent.length} элементов без social_platforms`);
  return filteredContent;
}

// Функция для удаления контента
async function deleteContent(contentId) {
  try {
    log(`Удаление контента ${contentId}...`);
    
    // Удаляем через storage API
    await storage.deleteCampaignContent(contentId);
    
    log(`Контент ${contentId} успешно удален`);
    return true;
  } catch (error) {
    log(`Ошибка удаления контента ${contentId}: ${error.message}`);
    return false;
  }
}

// Главная функция
async function main() {
  log('Начало процесса очистки контента...');
  
  try {
    // Получаем токен администратора
    const adminToken = await getAdminToken();
    
    if (!adminToken) {
      throw new Error('Не удалось получить токен администратора');
    }
    
    // Получаем весь контент кампании
    const allContent = await getCampaignContent(adminToken);
    
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
      const success = await deleteContent(content.id);
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

// Запускаем главную функцию
main();