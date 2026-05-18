import axios from 'axios';
import crypto from 'crypto';

// Конфигурация
const ACCESS_KEY = process.env.BEGET_S3_ACCESS_KEY;
const SECRET_KEY = process.env.BEGET_S3_SECRET_KEY;
const BUCKET = process.env.BEGET_S3_BUCKET;
const ENDPOINT = 's3.ru1.storage.beget.cloud';

/**
 * Подписывает строку с использованием алгоритма, который соответствует AWS S3
 */
function signString(stringToSign) {
  return crypto.createHmac('sha1', SECRET_KEY)
    .update(stringToSign, 'utf8')
    .digest('base64');
}

/**
 * Создает строку для подписи согласно протоколу AWS S3 версии 2
 */
function createStringToSign(method, contentType, date, resource, md5 = '') {
  return [
    method,
    md5,
    contentType,
    date,
    resource
  ].join('\n');
}

/**
 * Проверяет доступность бакета через HEAD запрос
 */
async function checkBucket() {
  try {
    console.log('=== Проверка доступности бакета (HEAD) ===');
    
    // Базовая информация
    console.log('Endpoint:', ENDPOINT);
    console.log('Bucket:', BUCKET);
    console.log('Access Key:', ACCESS_KEY);
    
    // Подготовка запроса
    const url = `https://${ENDPOINT}/${BUCKET}`;
    const date = new Date().toUTCString();
    
    // Подготовка строки для подписи - ключевой момент!
    const canonicalizedResource = `/${BUCKET}/`;
    const stringToSign = createStringToSign('HEAD', '', date, canonicalizedResource);
    
    // Создание подписи
    const signature = signString(stringToSign);
    
    // Заголовки запроса
    const headers = {
      'Host': ENDPOINT,
      'Date': date,
      'Authorization': `AWS ${ACCESS_KEY}:${signature}`
    };
    
    // Вывод отладочной информации
    console.log('\nURL:', url);
    console.log('Строка для подписи:', stringToSign.replace(/\n/g, '\\n'));
    console.log('Подпись:', signature);
    
    // Выполнение запроса
    console.log('\nОтправка HEAD запроса...');
    const response = await axios.head(url, { headers });
    
    console.log('Успех! Статус:', response.status);
    console.log('Заголовки ответа:', response.headers);
    return true;
  } catch (error) {
    console.error('\nОшибка при проверке бакета:', error.message);
    
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Заголовки ответа:', error.response.headers);
      
      if (error.response.data) {
        console.error('Данные ошибки:', error.response.data);
      }
    }
    
    return false;
  }
}

/**
 * Загружает текстовый файл в бакет
 */
async function uploadTextFile() {
  try {
    console.log('\n=== Загрузка тестового текстового файла ===');
    
    // Подготовка данных
    const content = `Тестовый файл. Время создания: ${new Date().toISOString()}`;
    const key = `test/file-${Date.now()}.txt`;
    const url = `https://${ENDPOINT}/${BUCKET}/${key}`;
    const contentType = 'text/plain';
    
    // Формирование даты и подписи
    const date = new Date().toUTCString();
    const resource = `/${BUCKET}/${key}`;
    const stringToSign = createStringToSign('PUT', contentType, date, resource);
    const signature = signString(stringToSign);
    
    // Заголовки запроса
    const headers = {
      'Host': ENDPOINT,
      'Date': date,
      'Content-Type': contentType,
      'Authorization': `AWS ${ACCESS_KEY}:${signature}`
    };
    
    // Отладочная информация
    console.log('URL:', url);
    console.log('Размер контента:', content.length, 'байт');
    console.log('Строка для подписи:', stringToSign.replace(/\n/g, '\\n'));
    console.log('Подпись:', signature);
    
    // Отправка запроса
    console.log('\nОтправка запроса на загрузку...');
    const response = await axios.put(url, content, { headers });
    
    console.log('Успех! Статус:', response.status);
    console.log('Файл доступен по адресу:', url);
    
    return url;
  } catch (error) {
    console.error('\nОшибка при загрузке файла:', error.message);
    
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Заголовки ответа:', error.response.headers);
      
      if (error.response.data) {
        console.error('Данные ошибки:', error.response.data);
      }
    }
    
    return null;
  }
}

async function main() {
  console.log('====== ТЕСТИРОВАНИЕ BEGET S3 API ======\n');
  
  // Проверка наличия всех переменных окружения
  if (!ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    console.error('Ошибка: Не указаны все необходимые переменные окружения.');
    console.error('Пожалуйста, установите BEGET_S3_ACCESS_KEY, BEGET_S3_SECRET_KEY и BEGET_S3_BUCKET.');
    process.exit(1);
  }
  
  // Проверка бакета
  await checkBucket();
  
  // Загрузка файла
  await uploadTextFile();
  
  console.log('\n====== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ======');
}

main();