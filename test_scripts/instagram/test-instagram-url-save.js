/**
 * Скрипт для тестирования сохранения URL Instagram-публикации
 * Использует прямые API-вызовы к социальным сервисам
 */

const axios = require('axios');
require('dotenv').config();

const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;

/**
 * Логирование в консоль и файл
 * @param {string} message Сообщение для вывода
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Получение токена администратора Directus
 * @returns {Promise<string|null>} Токен или null при ошибке
 */
async function getAdminToken() {
  try {
    log('Получение токена администратора...');
    const response = await axios.post(`${directusUrl}/auth/login`, {
      email: adminEmail,
      password: adminPassword
    });
    
    if (response?.data?.data?.access_token) {
      log('Токен получен успешно');
      return response.data.data.access_token;
    }
    
    log('Ошибка: токен отсутствует в ответе');
    return null;
  } catch (error) {
    log(`Ошибка при получении токена: ${error.message}`);
    return null;
  }
}

/**
 * Получение данных контента
 * @param {string} contentId ID контента
 * @param {string} token Токен авторизации
 * @returns {Promise<Object|null>} Данные контента или null при ошибке
 */
async function getContent(contentId, token) {
  try {
    log(`Получение контента ID: ${contentId}...`);
    const response = await axios.get(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response?.data?.data) {
      log('Данные контента получены успешно');
      return response.data.data;
    }
    
    log('Ошибка: данные контента отсутствуют в ответе');
    return null;
  } catch (error) {
    log(`Ошибка при получении контента: ${error.message}`);
    return null;
  }
}

/**
 * Сохранение URL для платформы
 * @param {string} contentId ID контента
 * @param {string} platform Название платформы
 * @param {string} url URL публикации
 * @param {string} token Токен авторизации
 * @returns {Promise<boolean>} Успешность операции
 */
async function saveUrlForPlatform(contentId, platform, url, token) {
  try {
    log(`Сохранение URL для платформы ${platform}...`);
    
    // 1. Получаем текущие данные
    const content = await getContent(contentId, token);
    if (!content) {
      return false;
    }
    
    // 2. Парсим текущие данные социальных платформ
    let socialPlatforms = {};
    try {
      if (content.social_platforms) {
        if (typeof content.social_platforms === 'string') {
          socialPlatforms = JSON.parse(content.social_platforms);
        } else if (typeof content.social_platforms === 'object') {
          socialPlatforms = {...content.social_platforms};
        }
      }
    } catch (error) {
      log(`Ошибка при парсинге social_platforms: ${error.message}`);
    }
    
    log(`Текущие платформы: ${Object.keys(socialPlatforms).join(', ')}`);
    
    // 3. Подготавливаем данные для обновления
    const platformData = socialPlatforms[platform] || {};
    
    // 4. Обновляем URL
    platformData.postUrl = url;
    platformData.status = 'published';
    platformData.publishedAt = new Date().toISOString();
    
    // 5. Обновляем данные платформы
    socialPlatforms[platform] = platformData;
    
    log(`Обновленные данные платформы ${platform}: ${JSON.stringify(platformData)}`);
    
    // 6. Сохраняем обновленные данные
    const updateResponse = await axios.patch(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        social_platforms: socialPlatforms
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (updateResponse?.data?.data) {
      log(`Данные успешно обновлены для платформы ${platform}`);
      
      // 7. Проверяем успешность обновления
      const updatedContent = await getContent(contentId, token);
      let updatedPlatforms = {};
      
      try {
        if (updatedContent.social_platforms) {
          if (typeof updatedContent.social_platforms === 'string') {
            updatedPlatforms = JSON.parse(updatedContent.social_platforms);
          } else if (typeof updatedContent.social_platforms === 'object') {
            updatedPlatforms = updatedContent.social_platforms;
          }
        }
      } catch (error) {
        log(`Ошибка при парсинге обновленных social_platforms: ${error.message}`);
      }
      
      if (updatedPlatforms[platform]?.postUrl === url) {
        log(`Верификация успешна: URL ${url} сохранен для платформы ${platform}`);
        return true;
      } else {
        log(`Ошибка верификации: URL не был сохранен корректно`);
        log(`Ожидаемый URL: ${url}`);
        log(`Фактический URL: ${updatedPlatforms[platform]?.postUrl}`);
        return false;
      }
    }
    
    log('Ошибка: данные обновления отсутствуют в ответе');
    return false;
  } catch (error) {
    log(`Ошибка при сохранении URL: ${error.message}`);
    if (error.response?.data) {
      log(`Детали ошибки API: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

/**
 * Тестовый запрос к /api/test/save-instagram-url
 * @param {string} contentId ID контента
 * @param {string} url URL публикации
 * @returns {Promise<boolean>} Успешность операции
 */
async function testApiSaveUrl(contentId, url) {
  try {
    log(`Тестирование API сохранения URL...`);
    
    const response = await axios.post(
      'http://localhost:5000/api/test/save-instagram-url',
      {
        contentId,
        postUrl: url,
        messageId: '12345' // Тестовый messageId
      }
    );
    
    if (response?.data?.success) {
      log(`API-запрос выполнен успешно: ${JSON.stringify(response.data)}`);
      
      if (response.data.instagram?.postUrl === url) {
        log(`Верификация успешна: URL ${url} сохранен через API`);
        return true;
      } else {
        log(`Ошибка верификации: URL не был сохранен корректно через API`);
        log(`Ожидаемый URL: ${url}`);
        log(`Фактический URL: ${response.data.instagram?.postUrl}`);
        return false;
      }
    }
    
    log(`Ошибка API: ${JSON.stringify(response.data)}`);
    return false;
  } catch (error) {
    log(`Ошибка при тестировании API: ${error.message}`);
    if (error.response?.data) {
      log(`Детали ошибки API: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

/**
 * Основная функция запуска тестов
 */
async function main() {
  try {
    log('=== ЗАПУСК ТЕСТИРОВАНИЯ СОХРАНЕНИЯ URL ===');
    
    // Убедитесь, что эти параметры соответствуют вашим данным
    const contentId = process.argv[2]; // ID контента передается первым аргументом
    const testUrl = `https://instagram.com/p/${Date.now()}`; // Тестовый URL с уникальным идентификатором
    
    if (!contentId) {
      log('ОШИБКА: Не указан ID контента');
      log('Использование: node test-instagram-url-save.js <contentId>');
      process.exit(1);
    }
    
    // 1. Получаем токен администратора
    const token = await getAdminToken();
    if (!token) {
      log('ОШИБКА: Не удалось получить токен администратора');
      process.exit(1);
    }
    
    // 2. Тестируем прямое сохранение через API Directus
    log('\n=== ТЕСТ 1: Прямое сохранение через Directus API ===');
    const directusResult = await saveUrlForPlatform(contentId, 'instagram', testUrl, token);
    log(`Результат прямого сохранения: ${directusResult ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // 3. Тестируем сохранение через тестовый API
    log('\n=== ТЕСТ 2: Сохранение через тестовый API ===');
    const apiResult = await testApiSaveUrl(contentId, `${testUrl}_api`);
    log(`Результат сохранения через API: ${apiResult ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // 4. Выводим общий результат
    log('\n=== ОБЩИЙ РЕЗУЛЬТАТ ===');
    if (directusResult && apiResult) {
      log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
    } else {
      log('❌ НЕКОТОРЫЕ ТЕСТЫ ЗАВЕРШИЛИСЬ С ОШИБКАМИ');
    }
    
  } catch (error) {
    log(`КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
    process.exit(1);
  }
}

// Запускаем тестирование
main();