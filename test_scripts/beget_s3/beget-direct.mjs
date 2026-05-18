import axios from 'axios';
import crypto from 'crypto';

// Ключи
const ACCESS_KEY = process.env.BEGET_S3_ACCESS_KEY;
const SECRET_KEY = process.env.BEGET_S3_SECRET_KEY;
const BUCKET = process.env.BEGET_S3_BUCKET;
const HOST = 's3.ru1.storage.beget.cloud';

// Функция для вывода информации
function log(msg) {
  console.log(msg);
}

// Подписать строку используя SHA1 HMAC
function hmacSha1(stringToSign, secret) {
  return crypto.createHmac('sha1', secret)
    .update(stringToSign, 'utf8')
    .digest('base64');
}

async function testAuth() {
  log("=== Тестирование прямого подключения к Beget S3 ===");
  log(`Бакет: ${BUCKET}`);
  log(`Ключ доступа: ${ACCESS_KEY.slice(0, 4)}...${ACCESS_KEY.slice(-4)}`);
  
  try {
    // Базовая информация для запроса
    const date = new Date().toUTCString();
    const method = 'GET'; // Используем GET вместо HEAD
    const resource = `/${BUCKET}/?location`;
    
    // Строка для подписи точно в формате AWS S3 V2
    const stringToSign = `${method}\n\n\n${date}\n${resource}`;
    
    // Создание подписи
    const signature = hmacSha1(stringToSign, SECRET_KEY);
    
    // URL и заголовки
    const url = `https://${HOST}${resource}`;
    const headers = {
      'Host': HOST,
      'Date': date,
      'Authorization': `AWS ${ACCESS_KEY}:${signature}`
    };
    
    log("\n=== Отладочная информация ===");
    log(`URL: ${url}`);
    log(`Метод: ${method}`);
    log(`Дата: ${date}`);
    log(`Строка для подписи: ${stringToSign.replace(/\n/g, '\\n')}`);
    log(`Подпись: ${signature}`);
    
    // Выполнение запроса
    log("\n=== Выполнение запроса ===");
    const response = await axios.get(url, { headers });
    
    log(`Статус: ${response.status}`);
    log("Ответ:");
    log(response.data);
    
    return true;
  } catch (error) {
    log("\n=== Ошибка ===");
    log(`Сообщение: ${error.message}`);
    
    if (error.response) {
      log(`Статус: ${error.response.status}`);
      if (error.response.data) {
        log("Данные ошибки:");
        log(error.response.data);
      }
    } else if (error.request) {
      log("Нет ответа от сервера");
    }
    
    return false;
  }
}

// Запуск теста
testAuth();