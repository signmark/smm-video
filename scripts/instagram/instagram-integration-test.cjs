/**
 * Интеграционные тесты для Instagram API интеграции
 * 
 * Тестирует:
 * 1. Прямую публикацию через Instagram API (инстанс instagramService)
 * 2. Публикацию через socialPublishingWithImgurService (имитация UI интерфейса)
 * 3. Дополнительные проверки форматирования и подготовки контента
 * 
 * Как запустить:
 * node instagram-integration-test.cjs
 */

const axios = require('axios');
const assert = require('assert').strict;
const { execSync } = require('child_process');

// Константы для тестирования
const API_URL = 'http://localhost:5000';
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
const TEST_IMAGE_URL = 'https://picsum.photos/800/800'; // Квадратное изображение 1:1
const MAX_TESTS = 1; // Максимальное количество тестов - всего 1 тест
const MAX_RETRIES = 1; // Максимальное количество повторных попыток - только 1 попытка

// Цвета для вывода в консоль
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Функция логирования с отметкой времени
function log(message, color = 'reset') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

/**
 * Выполняет прямой тест на публикацию в Instagram через API (минуя UI)
 */
async function testDirectInstagramApi() {
  log('Тест 1: Проверка прямого API Instagram через /api/test/instagram-post', 'blue');
  
  try {
    // Получаем настройки Instagram из тестовой кампании
    log('1.1. Получение настроек кампании...', 'cyan');
    
    const campaignResponse = await axios.get(`${API_URL}/api/campaign-settings/${CAMPAIGN_ID}`, {
      validateStatus: () => true
    });
    
    if (campaignResponse.status !== 200 || !campaignResponse.data.success) {
      log(`Не удалось получить настройки кампании: ${campaignResponse.data?.error || campaignResponse.statusText}`, 'red');
      log('Используем тестовые параметры из Instagram API теста...', 'yellow');
      
      // Тестируем напрямую через Instagram API тестовый маршрут
      const directParams = {
        text: `Интеграционный тест Instagram API - Прямой API - ${new Date().toISOString()}`,
        imageUrl: TEST_IMAGE_URL,
        token: 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R',
        businessAccountId: '17841422577074562'
      };
      
      log(`1.2. Отправка запроса на публикацию через Instagram API...`, 'cyan');
      log(`Параметры: текст (начало): ${directParams.text.substring(0, 30)}...`, 'cyan');
      log(`Изображение: ${directParams.imageUrl}`, 'cyan');
      
      const response = await axios.post(`${API_URL}/api/test/instagram-post`, directParams, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
      });
      
      log(`Статус ответа: ${response.status}`, response.status === 200 ? 'green' : 'red');
      
      if (response.status !== 200 || !response.data.success) {
        log(`Ошибка при публикации через прямой API: ${response.data?.error || response.statusText}`, 'red');
        log(`Подробности: ${JSON.stringify(response.data)}`, 'red');
        return {
          success: false,
          error: response.data?.error || response.statusText,
          details: response.data
        };
      }
      
      log(`Публикация успешна! ID поста: ${response.data.result?.postId || 'неизвестен'}`, 'green');
      log(`URL публикации: ${response.data.postUrl || response.data.result?.postUrl || 'неизвестен'}`, 'green');
      
      return {
        success: true,
        postId: response.data.result?.postId,
        postUrl: response.data.postUrl || response.data.result?.postUrl,
        data: response.data
      };
    } else {
      // Используем настройки из кампании
      const instagramSettings = campaignResponse.data.settings?.instagram;
      
      if (!instagramSettings || !instagramSettings.token || !instagramSettings.businessAccountId) {
        log('В настройках кампании отсутствуют параметры Instagram API', 'red');
        throw new Error('Отсутствуют настройки Instagram API в кампании');
      }
      
      const directParams = {
        text: `Интеграционный тест Instagram API - Прямой API - ${new Date().toISOString()}`,
        imageUrl: TEST_IMAGE_URL,
        token: instagramSettings.token,
        businessAccountId: instagramSettings.businessAccountId
      };
      
      log(`1.2. Отправка запроса на публикацию через Instagram API...`, 'cyan');
      log(`Параметры: текст (начало): ${directParams.text.substring(0, 30)}...`, 'cyan');
      log(`Изображение: ${directParams.imageUrl}`, 'cyan');
      
      const response = await axios.post(`${API_URL}/api/test/instagram-post`, directParams, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
      });
      
      log(`Статус ответа: ${response.status}`, response.status === 200 ? 'green' : 'red');
      
      if (response.status !== 200 || !response.data.success) {
        log(`Ошибка при публикации через прямой API: ${response.data?.error || response.statusText}`, 'red');
        log(`Подробности: ${JSON.stringify(response.data)}`, 'red');
        return {
          success: false,
          error: response.data?.error || response.statusText,
          details: response.data
        };
      }
      
      log(`Публикация успешна! ID поста: ${response.data.result?.postId || 'неизвестен'}`, 'green');
      log(`URL публикации: ${response.data.postUrl || response.data.result?.postUrl || 'неизвестен'}`, 'green');
      
      return {
        success: true,
        postId: response.data.result?.postId,
        postUrl: response.data.postUrl || response.data.result?.postUrl,
        data: response.data
      };
    }
  } catch (error) {
    log(`Ошибка в тесте Instagram API: ${error.message}`, 'red');
    if (error.response) {
      log(`Ответ API: ${JSON.stringify(error.response.data)}`, 'red');
    }
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data || null
    };
  }
}

/**
 * Тестирует публикацию в Instagram через UI (socialPublishingWithImgurService)
 */
async function testSocialPublishingInstagram() {
  log('Тест 2: Проверка API Instagram через UI-интерфейс (socialPublishingWithImgurService)', 'blue');
  
  try {
    // Отправляем запрос на тестовый маршрут, который использует socialPublishingService
    log('2.1. Отправка запроса на публикацию через имитацию UI...', 'cyan');
    
    const testParams = {
      text: `Интеграционный тест UI Instagram публикации - ${new Date().toISOString()}`,
      imageUrl: TEST_IMAGE_URL,
      campaignId: CAMPAIGN_ID
    };
    
    log(`Параметры: текст (начало): ${testParams.text.substring(0, 30)}...`, 'cyan');
    log(`Изображение: ${testParams.imageUrl}`, 'cyan');
    log(`ID кампании: ${testParams.campaignId}`, 'cyan');
    
    const response = await axios.post(`${API_URL}/api/test/instagram-ui-test`, testParams, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true
    });
    
    log(`Статус ответа: ${response.status}`, response.status === 200 ? 'green' : 'red');
    
    if (response.status !== 200 || !response.data.success) {
      log(`Ошибка при публикации через UI API: ${response.data?.error || response.statusText}`, 'red');
      log(`Подробности: ${JSON.stringify(response.data)}`, 'red');
      return {
        success: false,
        error: response.data?.error || response.statusText,
        details: response.data
      };
    }
    
    log(`Публикация успешна! ID поста: ${response.data.result?.postId || 'неизвестен'}`, 'green');
    log(`URL публикации: ${response.data.postUrl || response.data.result?.postUrl || 'неизвестен'}`, 'green');
    
    return {
      success: true,
      postId: response.data.result?.postId,
      postUrl: response.data.postUrl || response.data.result?.postUrl,
      data: response.data
    };
  } catch (error) {
    log(`Ошибка в тесте UI Instagram публикации: ${error.message}`, 'red');
    if (error.response) {
      log(`Ответ API: ${JSON.stringify(error.response.data)}`, 'red');
    }
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data || null
    };
  }
}

/**
 * Выполняет все тесты и выводит итоговый отчет
 */
async function runAllTests() {
  log('Начинаем интеграционные тесты для Instagram API', 'magenta');
  log('------------------------------------------------------', 'magenta');
  
  const results = {
    directApi: null,
    uiApi: null
  };
  
  // Тест 1: Прямой Instagram API
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) {
      log(`Повторная попытка #${i} для теста прямого Instagram API...`, 'yellow');
    }
    
    results.directApi = await testDirectInstagramApi();
    
    if (results.directApi.success) {
      break;
    } else if (i < MAX_RETRIES - 1) {
      log('Ожидание перед повторной попыткой...', 'yellow');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 секунд перед повтором
    }
  }
  
  log('------------------------------------------------------', 'magenta');
  
  // Тест 2: UI Instagram API через socialPublishingWithImgurService
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) {
      log(`Повторная попытка #${i} для теста Instagram API через UI...`, 'yellow');
    }
    
    results.uiApi = await testSocialPublishingInstagram();
    
    if (results.uiApi.success) {
      break;
    } else if (i < MAX_RETRIES - 1) {
      log('Ожидание перед повторной попыткой...', 'yellow');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 секунд перед повтором
    }
  }
  
  log('------------------------------------------------------', 'magenta');
  
  // Итоговый отчет
  log('ИТОГОВЫЙ ОТЧЕТ', 'magenta');
  log('------------------------------------------------------', 'magenta');
  log(`Тест 1 (Прямой Instagram API): ${results.directApi?.success ? 'УСПЕХ ✅' : 'НЕУДАЧА ❌'}`, results.directApi?.success ? 'green' : 'red');
  if (results.directApi?.success) {
    log(`  URL публикации: ${results.directApi.postUrl || 'недоступен'}`, 'green');
  } else {
    log(`  Ошибка: ${results.directApi?.error || 'Неизвестная ошибка'}`, 'red');
  }
  
  log(`Тест 2 (Instagram API через UI): ${results.uiApi?.success ? 'УСПЕХ ✅' : 'НЕУДАЧА ❌'}`, results.uiApi?.success ? 'green' : 'red');
  if (results.uiApi?.success) {
    log(`  URL публикации: ${results.uiApi.postUrl || 'недоступен'}`, 'green');
  } else {
    log(`  Ошибка: ${results.uiApi?.error || 'Неизвестная ошибка'}`, 'red');
  }
  
  log('------------------------------------------------------', 'magenta');
  
  const allPassed = results.directApi?.success && results.uiApi?.success;
  log(`ОБЩИЙ РЕЗУЛЬТАТ: ${allPassed ? 'ВСЕ ТЕСТЫ ПРОЙДЕНЫ ✅' : 'ЕСТЬ НЕУДАЧНЫЕ ТЕСТЫ ❌'}`, allPassed ? 'green' : 'red');
  
  process.exit(allPassed ? 0 : 1); // Выходим с кодом ошибки, если есть неудачные тесты
}

// Запуск тестов
runAllTests()
  .catch(error => {
    log(`Критическая ошибка при выполнении тестов: ${error.message}`, 'red');
    process.exit(1);
  });