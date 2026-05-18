/**
 * Прямой тест загрузки файлов в Beget S3
 */

import * as dotenv from 'dotenv';
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Загружаем переменные окружения
dotenv.config();

// Извлекаем конфигурацию Beget S3 из переменных окружения
const s3Config = {
  bucket: process.env.BEGET_S3_BUCKET || '6e679636ae90-ridiculous-seth',
  region: process.env.BEGET_S3_REGION || 'ru-central-1',
  endpoint: process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
  credentials: {
    accessKeyId: process.env.BEGET_S3_ACCESS_KEY, 
    secretAccessKey: process.env.BEGET_S3_SECRET_KEY
  }
};

// Создаем клиент S3
const s3Client = new S3Client({
  region: s3Config.region,
  endpoint: s3Config.endpoint,
  credentials: s3Config.credentials,
  forcePathStyle: true // Требуется для совместимости с Beget S3
});

async function testBegetS3() {
  try {
    console.log('Инициализация прямого теста Beget S3...');
    console.log('Используемая конфигурация:');
    console.log('- Bucket:', s3Config.bucket);
    console.log('- Region:', s3Config.region);
    console.log('- Endpoint:', s3Config.endpoint);
    console.log('- Access Key:', s3Config.credentials.accessKeyId ? 'Установлен' : 'Не установлен');
    console.log('- Secret Key:', s3Config.credentials.secretAccessKey ? 'Установлен' : 'Не установлен');
    
    // Создаем тестовый контент
    const testContent = `Тестовое сообщение, созданное в ${new Date().toISOString()}`;
    const testKey = `test-direct-${Date.now()}.txt`;
    
    // Загружаем контент
    console.log(`\nЗагрузка файла с ключом ${testKey}...`);
    
    const uploadParams = {
      Bucket: s3Config.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
      ACL: 'public-read' // Публичный доступ для файла
    };
    
    // Используем Upload для поддержки файлов любого размера
    const upload = new Upload({
      client: s3Client,
      params: uploadParams
    });
    
    const uploadResult = await upload.done();
    console.log('Результат загрузки:', uploadResult);
    
    // Проверяем наличие файла
    console.log('\nПроверка наличия файла...');
    const headParams = {
      Bucket: s3Config.bucket,
      Key: testKey
    };
    
    const headCommand = new HeadObjectCommand(headParams);
    const headResult = await s3Client.send(headCommand);
    console.log('Файл существует:', !!headResult);
    console.log('Размер файла:', headResult.ContentLength, 'байт');
    
    // Получаем список файлов
    console.log('\nПолучение списка файлов...');
    const listParams = {
      Bucket: s3Config.bucket,
      Prefix: 'test-direct-', // Ищем только наши тестовые файлы
      MaxKeys: 10
    };
    
    const listCommand = new ListObjectsCommand(listParams);
    const listResult = await s3Client.send(listCommand);
    
    if (listResult.Contents && listResult.Contents.length > 0) {
      console.log(`Найдено ${listResult.Contents.length} файлов:`);
      listResult.Contents.forEach((file, index) => {
        console.log(`${index + 1}. ${file.Key} (${file.Size} байт)`);
      });
    } else {
      console.log('Файлы не найдены');
    }
    
    // Создаем URL для доступа к файлу
    console.log('\nСоздание URL для доступа к файлу...');
    const getObjectParams = {
      Bucket: s3Config.bucket,
      Key: testKey
    };
    
    const getCommand = new HeadObjectCommand(getObjectParams);
    const signedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 }); // Истекает через 1 час
    console.log('Подписанный URL:', signedUrl);
    
    // Создаем публичный URL
    const publicUrl = `${s3Config.endpoint}/${s3Config.bucket}/${testKey}`;
    console.log('Публичный URL:', publicUrl);
    
    console.log('\nПрямой тест Beget S3 успешно завершен!');
  } catch (error) {
    console.error('Ошибка при тестировании Beget S3:', error);
  }
}

// Запускаем тест
testBegetS3();