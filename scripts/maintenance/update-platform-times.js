/**
 * Скрипт для обновления времени публикации для всех платформ в существующих записях
 * Решает проблему, когда у платформ нет собственного поля scheduledAt
 * 
 * Запускается: node update-platform-times.js
 */

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Получаем параметры из .env или используем значения по умолчанию
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const DIRECTUS_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

/**
 * Логирование с временной меткой
 * @param {string} message Сообщение для логирования
 */
function log(message) {
  const now = new Date();
  const timestamp = now.toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Авторизация в Directus и получение административного токена
 * @returns {Promise<string|null>} Токен администратора или null в случае ошибки
 */
async function authenticate() {
  try {
    log(`Авторизация администратора в Directus (${DIRECTUS_URL})`);
    
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD,
    });
    
    if (response.data && response.data.data && response.data.data.access_token) {
      log('Авторизация успешна');
      return response.data.data.access_token;
    } else {
      log('Ошибка авторизации: неверный формат ответа');
      return null;
    }
  } catch (error) {
    log(`Ошибка авторизации: ${error.message}`);
    return null;
  }
}

/**
 * Получает все запланированные публикации
 * @param {string} token Токен администратора
 * @returns {Promise<Array|null>} Массив запланированных публикаций или null в случае ошибки
 */
async function getScheduledPublications(token) {
  try {
    log('Получение всех запланированных публикаций');
    
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      params: {
        filter: { status: { _eq: 'scheduled' } },
        limit: 100
      },
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.data && response.data.data && Array.isArray(response.data.data)) {
      log(`Получено ${response.data.data.length} запланированных публикаций`);
      return response.data.data;
    } else {
      log('Ошибка получения публикаций: неверный формат ответа');
      return null;
    }
  } catch (error) {
    log(`Ошибка получения публикаций: ${error.message}`);
    return null;
  }
}

/**
 * Обновляет данные о времени публикации для всех платформ
 * @param {string} token Токен администратора
 * @param {Object} publication Публикация для обновления
 * @returns {Promise<boolean>} Успешно обновлено или нет
 */
async function updatePublicationTimes(token, publication) {
  try {
    // Проверяем, что у публикации есть scheduledAt и socialPlatforms
    if (!publication.scheduled_at || !publication.social_platforms) {
      log(`Публикация ${publication.id} не имеет времени публикации или платформ. Пропуск.`);
      return false;
    }
    
    // Конвертируем в JavaScript-объект, если это строка
    let socialPlatforms = publication.social_platforms;
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (error) {
        log(`Ошибка парсинга JSON для публикации ${publication.id}: ${error.message}`);
        return false;
      }
    }
    
    // Получаем дату публикации
    const scheduledAtDate = new Date(publication.scheduled_at);
    
    // Флаг, показывающий, были ли изменения
    let hasChanges = false;
    
    // Для каждой платформы проверяем наличие scheduledAt
    Object.keys(socialPlatforms).forEach(platform => {
      if (!socialPlatforms[platform]) {
        // Если платформа указана, но нет данных, создаем объект
        socialPlatforms[platform] = {
          platform: platform,
          status: 'pending',
          scheduledAt: scheduledAtDate.toISOString()
        };
        hasChanges = true;
        log(`Создана новая запись для платформы ${platform} в публикации ${publication.id}`);
      } 
      else if (!socialPlatforms[platform].scheduledAt) {
        // Если у платформы отсутствует время публикации, устанавливаем общее
        socialPlatforms[platform].scheduledAt = scheduledAtDate.toISOString();
        hasChanges = true;
        log(`Добавлено время публикации для платформы ${platform} в публикации ${publication.id}`);
      }
    });
    
    // Если были изменения, обновляем запись в Directus
    if (hasChanges) {
      log(`Обновление данных для публикации ${publication.id}`);
      
      const updateResponse = await axios.patch(
        `${DIRECTUS_URL}/items/campaign_content/${publication.id}`,
        { social_platforms: socialPlatforms },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      
      if (updateResponse.status === 200) {
        log(`Публикация ${publication.id} успешно обновлена`);
        return true;
      } else {
        log(`Ошибка обновления публикации ${publication.id}: неверный статус ответа ${updateResponse.status}`);
        return false;
      }
    } else {
      log(`Публикация ${publication.id} не требует обновления`);
      return false;
    }
  } catch (error) {
    log(`Ошибка при обновлении публикации ${publication.id}: ${error.message}`);
    return false;
  }
}

/**
 * Основная функция
 */
async function main() {
  try {
    // Получаем токен администратора
    const token = await authenticate();
    if (!token) {
      log('Не удалось получить токен администратора. Завершение скрипта.');
      return;
    }
    
    // Получаем все запланированные публикации
    const publications = await getScheduledPublications(token);
    if (!publications || publications.length === 0) {
      log('Нет запланированных публикаций для обновления. Завершение скрипта.');
      return;
    }
    
    // Счетчики для статистики
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Обновляем каждую публикацию
    for (const publication of publications) {
      const updated = await updatePublicationTimes(token, publication);
      if (updated) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    }
    
    // Выводим итоговую статистику
    log(`Обработка завершена. Обновлено: ${updatedCount}, Пропущено: ${skippedCount}, Ошибок: ${errorCount}`);
    
  } catch (error) {
    log(`Критическая ошибка: ${error.message}`);
  }
}

// Запускаем основную функцию
main();