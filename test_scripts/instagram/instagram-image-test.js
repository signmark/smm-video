/**
 * Скрипт для проверки доступности и параметров изображений для Instagram API
 * 
 * Этот скрипт проверяет доступность изображений, загружаемых в Instagram,
 * и соответствие их параметров требованиям Instagram API.
 * 
 * Запуск: node instagram-image-test.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Тестовые URL изображений
const testImages = [
  'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png',
  'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png'
];

// Получаем токен и ID из переменных окружения или конфигурационного файла
const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '';

/**
 * Проверяет доступность изображения и его параметры
 * @param {string} imageUrl URL изображения для проверки
 * @returns {Promise<Object>} Результат проверки
 */
async function checkImage(imageUrl) {
  console.log(`\nПроверка изображения: ${imageUrl}`);
  
  try {
    // Проверка доступности изображения
    console.log('1. Проверка доступности изображения...');
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    console.log(`Статус ответа: ${imageResponse.status}`);
    console.log(`Content-Type: ${imageResponse.headers['content-type']}`);
    console.log(`Размер ответа: ${imageResponse.data.length} байт`);
    
    // Создание тестового контейнера в Instagram
    if (accessToken && accountId) {
      console.log('\n2. Тестирование создания контейнера в Instagram...');
      try {
        const instagramResponse = await axios.post(
          `https://graph.facebook.com/v16.0/${accountId}/media`,
          {
            image_url: imageUrl,
            is_carousel_item: true,
            access_token: accessToken
          },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log('Ответ Instagram API:');
        console.log(JSON.stringify(instagramResponse.data, null, 2));
        
        // Если создание контейнера успешно, удаляем его
        if (instagramResponse.data && instagramResponse.data.id) {
          console.log(`Контейнер успешно создан, ID: ${instagramResponse.data.id}`);
          return {
            success: true,
            url: imageUrl,
            instagramResponse: instagramResponse.data
          };
        } else {
          console.log('Не удалось создать контейнер: ответ без ID');
          return {
            success: false,
            url: imageUrl,
            error: 'Ответ без ID',
            instagramResponse: instagramResponse.data
          };
        }
      } catch (instagramError) {
        console.error('Ошибка при создании контейнера в Instagram:');
        if (instagramError.response) {
          console.error('Детали ошибки:', JSON.stringify(instagramError.response.data, null, 2));
          return {
            success: false,
            url: imageUrl,
            error: instagramError.message,
            details: instagramError.response.data
          };
        } else {
          console.error(instagramError.message);
          return {
            success: false,
            url: imageUrl,
            error: instagramError.message
          };
        }
      }
    } else {
      console.log('\n2. Пропуск тестирования Instagram API: нет токена или ID аккаунта');
      return {
        success: true,
        url: imageUrl,
        message: 'Изображение доступно, но тестирование Instagram API пропущено'
      };
    }
  } catch (error) {
    console.error('Ошибка при проверке изображения:');
    if (error.response) {
      console.error(`Статус ответа: ${error.response.status}`);
      console.error(`Сообщение: ${error.message}`);
      return {
        success: false,
        url: imageUrl,
        error: error.message,
        status: error.response.status
      };
    } else {
      console.error(error.message);
      return {
        success: false,
        url: imageUrl,
        error: error.message
      };
    }
  }
}

/**
 * Проверяет все тестовые изображения и составляет отчет
 */
async function runTests() {
  console.log('==== НАЧАЛО ТЕСТИРОВАНИЯ ИЗОБРАЖЕНИЙ ДЛЯ INSTAGRAM ====');
  
  if (!accessToken || !accountId) {
    console.warn('\n⚠️ ВНИМАНИЕ: Переменные окружения INSTAGRAM_ACCESS_TOKEN и/или INSTAGRAM_BUSINESS_ACCOUNT_ID не установлены!');
    console.warn('Будет выполнена только проверка доступности изображений без тестирования Instagram API.');
  }
  
  const results = [];
  
  for (const imageUrl of testImages) {
    const result = await checkImage(imageUrl);
    results.push(result);
  }
  
  // Сохранение результатов в файл
  const report = {
    timestamp: new Date().toISOString(),
    accessTokenProvided: !!accessToken,
    accountIdProvided: !!accountId,
    results: results
  };
  
  fs.writeFileSync('instagram-image-test-report.json', JSON.stringify(report, null, 2));
  console.log('\nОтчет сохранен в файл: instagram-image-test-report.json');
  
  // Вывод сводки результатов
  console.log('\n==== СВОДКА РЕЗУЛЬТАТОВ ====');
  let allSuccess = true;
  
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.url} - УСПЕШНО`);
    } else {
      console.log(`❌ ${result.url} - ОШИБКА: ${result.error}`);
      allSuccess = false;
    }
  }
  
  if (allSuccess) {
    console.log('\n✅ ВСЕ ИЗОБРАЖЕНИЯ ПРОШЛИ ПРОВЕРКУ УСПЕШНО');
  } else {
    console.log('\n❌ НЕКОТОРЫЕ ИЗОБРАЖЕНИЯ НЕ ПРОШЛИ ПРОВЕРКУ');
  }
  
  console.log('==== ЗАВЕРШЕНИЕ ТЕСТИРОВАНИЯ ИЗОБРАЖЕНИЙ ДЛЯ INSTAGRAM ====');
}

// Запуск тестов
runTests().catch(error => {
  console.error('Ошибка при выполнении тестов:', error);
});