/**
 * Скрипт для тестирования Beget S3 API маршрутов
 * Используется простой fetch-запрос с использованием только стандартных модулей Node.js
 */

// В Node.js 18+ fetch является глобальным
// Но если используется более старая версия, то нужен import
// import fetch from 'node-fetch';

// Тестовый контент для загрузки
const testContent = `Тестовый контент, созданный ${new Date().toISOString()}`;
const testFilename = `test-api-${Date.now()}.txt`;

// URL для тестирования API
const apiTestUrl = 'http://localhost:5000/api/beget-s3/test';
const apiUploadUrl = 'http://localhost:5000/api/beget-s3/upload-content';
const apiInfoUrl = 'http://localhost:5000/api/beget-s3/info';

// Функция для тестирования API подключения к Beget S3
async function testConnection() {
  console.log('Тестирование подключения к Beget S3 API...');
  
  try {
    const response = await fetch(apiTestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const statusCode = response.status;
    console.log('Статус ответа:', statusCode);
    
    if (response.ok) {
      try {
        const text = await response.text();
        
        try {
          // Пробуем распарсить как JSON
          const data = JSON.parse(text);
          console.log('Ответ API (JSON):', JSON.stringify(data, null, 2));
        } catch (e) {
          // Если не получается, выводим как текст
          console.log('Ответ API (текст):', text.substring(0, 500) + (text.length > 500 ? '...' : ''));
        }
        
        return true;
      } catch (e) {
        console.error('Ошибка при чтении ответа:', e);
        return false;
      }
    } else {
      try {
        const text = await response.text();
        console.error('Ошибка API:', statusCode, text.substring(0, 500) + (text.length > 500 ? '...' : ''));
      } catch (e) {
        console.error('Ошибка API:', statusCode, 'Не удалось прочитать тело ответа');
      }
      return false;
    }
  } catch (error) {
    console.error('Ошибка при тестировании подключения:', error);
    return false;
  }
}

// Функция для тестирования загрузки контента в Beget S3
async function testUpload() {
  console.log('\nТестирование загрузки контента в Beget S3...');
  
  try {
    const response = await fetch(apiUploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: testContent,
        filename: testFilename,
        contentType: 'text/plain',
        folder: 'test-uploads'
      })
    });
    
    const statusCode = response.status;
    console.log('Статус ответа:', statusCode);
    
    if (response.ok) {
      try {
        const text = await response.text();
        
        try {
          // Пробуем распарсить как JSON
          const data = JSON.parse(text);
          console.log('Ответ API (JSON):', JSON.stringify(data, null, 2));
          return data;
        } catch (e) {
          // Если не получается, выводим как текст
          console.log('Ответ API (текст):', text.substring(0, 500) + (text.length > 500 ? '...' : ''));
          return null;
        }
      } catch (e) {
        console.error('Ошибка при чтении ответа:', e);
        return null;
      }
    } else {
      try {
        const text = await response.text();
        console.error('Ошибка API:', statusCode, text.substring(0, 500) + (text.length > 500 ? '...' : ''));
      } catch (e) {
        console.error('Ошибка API:', statusCode, 'Не удалось прочитать тело ответа');
      }
      return null;
    }
  } catch (error) {
    console.error('Ошибка при тестировании загрузки:', error);
    return null;
  }
}

// Функция для получения информации о Beget S3
async function getInfo() {
  console.log('\nПолучение информации о Beget S3...');
  
  try {
    const response = await fetch(apiInfoUrl, {
      method: 'GET'
    });
    
    const statusCode = response.status;
    console.log('Статус ответа:', statusCode);
    
    if (response.ok) {
      try {
        const text = await response.text();
        
        try {
          // Пробуем распарсить как JSON
          const data = JSON.parse(text);
          console.log('Информация о Beget S3 (JSON):', JSON.stringify(data, null, 2));
          return data;
        } catch (e) {
          // Если не получается, выводим как текст
          console.log('Информация о Beget S3 (текст):', text.substring(0, 500) + (text.length > 500 ? '...' : ''));
          return null;
        }
      } catch (e) {
        console.error('Ошибка при чтении ответа:', e);
        return null;
      }
    } else {
      try {
        const text = await response.text();
        console.error('Ошибка API:', statusCode, text.substring(0, 500) + (text.length > 500 ? '...' : ''));
      } catch (e) {
        console.error('Ошибка API:', statusCode, 'Не удалось прочитать тело ответа');
      }
      return null;
    }
  } catch (error) {
    console.error('Ошибка при получении информации:', error);
    return null;
  }
}

// Функция для запуска всех тестов
async function runTests() {
  console.log('=== Начало тестирования Beget S3 API ===');
  
  // Тест подключения
  const connectionResult = await testConnection();
  
  if (connectionResult) {
    // Тест загрузки
    const uploadResult = await testUpload();
    
    if (uploadResult && uploadResult.success) {
      console.log(`\nФайл успешно загружен: ${uploadResult.url}`);
      
      // Проверка доступности файла
      console.log('\nПроверка доступности файла...');
      try {
        const fileResponse = await fetch(uploadResult.url);
        if (fileResponse.ok) {
          const fileContent = await fileResponse.text();
          console.log('Содержимое файла:', fileContent);
          
          if (fileContent === testContent) {
            console.log('Проверка пройдена: содержимое файла совпадает!');
          } else {
            console.error('Проверка не пройдена: содержимое файла не совпадает!');
          }
        } else {
          console.error('Файл недоступен:', fileResponse.status, fileResponse.statusText);
        }
      } catch (error) {
        console.error('Ошибка при проверке доступности файла:', error);
      }
    }
    
    // Получение информации о Beget S3
    await getInfo();
  }
  
  console.log('\n=== Тестирование Beget S3 API завершено ===');
}

// Запуск тестов
runTests().catch(console.error);