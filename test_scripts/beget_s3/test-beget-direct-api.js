/**
 * Тестирование Beget S3 через прямые HTTP запросы
 * Этот скрипт обходит необходимость использования AWS SDK
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Получаем путь к текущей директории
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config();

// Настройки Beget S3
const s3Config = {
  bucket: process.env.BEGET_S3_BUCKET || '6e679636ae90-ridiculous-seth',
  region: process.env.BEGET_S3_REGION || 'ru-central-1',
  endpoint: process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
  accessKeyId: process.env.BEGET_S3_ACCESS_KEY,
  secretAccessKey: process.env.BEGET_S3_SECRET_KEY,
  publicUrl: process.env.BEGET_S3_PUBLIC_URL || 'https://s3.ru1.storage.beget.cloud/6e679636ae90-ridiculous-seth'
};

// Получаем текущую дату в формате, используемом AWS
function getAmzDate() {
  const date = new Date();
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '').substring(0, 15) + 'Z';
}

// Получаем дату для заголовка x-amz-date
function getAmzDateHeader() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').substring(0, 8);
}

// Создаем строку для подписи авторизации AWS Signature V4
function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

// Создаем подпись для авторизации запроса
function signRequest(method, path, headers, payload = '') {
  const amzDate = getAmzDate();
  const dateStamp = amzDate.substring(0, 8);
  
  // Канонический запрос
  const canonicalUri = path;
  const canonicalQueryString = '';
  
  // Канонические заголовки
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(name => `${name.toLowerCase()}:${headers[name]}\n`)
    .join('');
  
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(name => name.toLowerCase())
    .join(';');
  
  // Создаем хеш полезной нагрузки
  const payloadHash = crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex');
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  // Формируем строку для подписи
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${s3Config.region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  // Вычисляем подпись
  const signingKey = getSignatureKey(
    s3Config.secretAccessKey,
    dateStamp,
    s3Config.region,
    's3'
  );
  
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');
  
  // Составляем заголовок авторизации
  const authorizationHeader = [
    `${algorithm} Credential=${s3Config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(', ');
  
  return authorizationHeader;
}

// Загружает файл в Beget S3 через прямой POST-запрос
async function uploadFileToBegetS3(content, key, contentType = 'text/plain') {
  try {
    console.log(`Загрузка файла ${key} в Beget S3...`);
    
    const url = `${s3Config.endpoint}/${s3Config.bucket}/${key}`;
    const amzDate = getAmzDate();
    
    const headers = {
      'Host': new URL(s3Config.endpoint).host,
      'Content-Type': contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': crypto.createHash('sha256').update(content).digest('hex'),
      'x-amz-acl': 'public-read'
    };
    
    // Подписываем запрос
    const authHeader = signRequest('PUT', `/${s3Config.bucket}/${key}`, headers, content);
    headers['Authorization'] = authHeader;
    
    // Отправляем запрос к Beget S3
    const response = await fetch(url, {
      method: 'PUT',
      headers: headers,
      body: content
    });
    
    if (response.ok) {
      console.log(`Файл ${key} успешно загружен в Beget S3`);
      const fileUrl = `${s3Config.publicUrl}/${key}`;
      console.log(`URL файла: ${fileUrl}`);
      return {
        success: true,
        key: key,
        url: fileUrl
      };
    } else {
      const errorText = await response.text();
      console.error(`Ошибка при загрузке файла: ${response.status} ${response.statusText}`);
      console.error(`Текст ошибки: ${errorText}`);
      return {
        success: false,
        error: `HTTP Error: ${response.status} ${response.statusText}`,
        details: errorText
      };
    }
  } catch (error) {
    console.error('Ошибка при загрузке файла в Beget S3:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Проверяет существование файла в Beget S3
async function checkFileExists(key) {
  try {
    console.log(`Проверка наличия файла ${key} в Beget S3...`);
    
    const url = `${s3Config.endpoint}/${s3Config.bucket}/${key}`;
    const amzDate = getAmzDate();
    
    const headers = {
      'Host': new URL(s3Config.endpoint).host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // SHA-256 хеш пустой строки
    };
    
    // Подписываем запрос
    const authHeader = signRequest('HEAD', `/${s3Config.bucket}/${key}`, headers);
    headers['Authorization'] = authHeader;
    
    // Отправляем запрос к Beget S3
    const response = await fetch(url, {
      method: 'HEAD',
      headers: headers
    });
    
    const exists = response.ok;
    console.log(`Файл ${key} ${exists ? 'существует' : 'не существует'} в Beget S3`);
    
    if (exists) {
      return {
        success: true,
        exists: true,
        size: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
        lastModified: response.headers.get('last-modified')
      };
    } else {
      return {
        success: true,
        exists: false
      };
    }
  } catch (error) {
    console.error('Ошибка при проверке наличия файла:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Получает список файлов из Beget S3
async function listFilesInBegetS3(prefix = '') {
  try {
    console.log(`Получение списка файлов из Beget S3 с префиксом ${prefix || '(корень)'}...`);
    
    // Строим URL с параметрами
    const queryParams = new URLSearchParams();
    if (prefix) {
      queryParams.append('prefix', prefix);
    }
    
    const url = `${s3Config.endpoint}/${s3Config.bucket}?${queryParams.toString()}`;
    const amzDate = getAmzDate();
    
    const headers = {
      'Host': new URL(s3Config.endpoint).host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // SHA-256 хеш пустой строки
    };
    
    // Подписываем запрос
    const authHeader = signRequest('GET', `/${s3Config.bucket}`, headers);
    headers['Authorization'] = authHeader;
    
    // Отправляем запрос к Beget S3
    const response = await fetch(url, {
      method: 'GET',
      headers: headers
    });
    
    if (response.ok) {
      const text = await response.text();
      
      // Парсим XML ответ (упрощенно, для полноценного использования лучше использовать XML-parser)
      const fileKeys = [];
      const keyMatches = text.match(/<Key>(.+?)<\/Key>/g);
      
      if (keyMatches) {
        keyMatches.forEach(match => {
          const key = match.replace('<Key>', '').replace('</Key>', '');
          fileKeys.push(key);
        });
      }
      
      console.log(`Получено ${fileKeys.length} файлов из Beget S3`);
      
      return {
        success: true,
        files: fileKeys
      };
    } else {
      const errorText = await response.text();
      console.error(`Ошибка при получении списка файлов: ${response.status} ${response.statusText}`);
      console.error(`Текст ошибки: ${errorText}`);
      return {
        success: false,
        error: `HTTP Error: ${response.status} ${response.statusText}`,
        details: errorText
      };
    }
  } catch (error) {
    console.error('Ошибка при получении списка файлов из Beget S3:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Основная функция для тестирования
async function testBegetS3() {
  try {
    console.log('Запуск тестирования Beget S3 через прямые HTTP запросы...');
    console.log('Конфигурация:');
    console.log(`- Bucket: ${s3Config.bucket}`);
    console.log(`- Endpoint: ${s3Config.endpoint}`);
    console.log(`- Region: ${s3Config.region}`);
    console.log(`- Access Key: ${s3Config.accessKeyId ? 'Установлен' : 'Не установлен'}`);
    console.log(`- Secret Key: ${s3Config.secretAccessKey ? 'Установлен' : 'Не установлен'}`);
    
    // Создаем тестовый контент
    const testContent = `Тестовое содержимое от ${new Date().toISOString()}`;
    const testKey = `test-api-${Date.now()}.txt`;
    
    // Загружаем контент
    console.log('\n=== Загрузка тестового файла ===');
    const uploadResult = await uploadFileToBegetS3(testContent, testKey);
    
    if (uploadResult.success) {
      // Проверяем наличие файла
      console.log('\n=== Проверка наличия файла ===');
      const checkResult = await checkFileExists(testKey);
      
      // Получаем список файлов
      console.log('\n=== Получение списка файлов с префиксом test-api ===');
      const listResult = await listFilesInBegetS3('test-api');
      
      if (listResult.success && listResult.files.length > 0) {
        console.log('\nСписок файлов:');
        listResult.files.slice(0, 10).forEach((file, index) => {
          console.log(`${index + 1}. ${file}`);
        });
        
        if (listResult.files.length > 10) {
          console.log(`...и еще ${listResult.files.length - 10} файлов`);
        }
      }
      
      console.log('\n=== Проверка прямого доступа к файлу ===');
      const fileUrl = `${s3Config.publicUrl}/${testKey}`;
      console.log(`URL файла: ${fileUrl}`);
      
      console.log('\nТестирование Beget S3 через прямые HTTP запросы успешно завершено!');
    }
  } catch (error) {
    console.error('Ошибка при тестировании Beget S3:', error);
  }
}

// Запускаем тестирование
testBegetS3();