/**
 * Скрипт для проверки локально установленных библиотек AWS SDK
 */

// Настройка путей к локальным модулям
const LOCAL_MODULES_PATH = './custom_modules/@aws-sdk';
const S3_CLIENT_PATH = `${LOCAL_MODULES_PATH}/client-s3`;
const PRESIGNER_PATH = `${LOCAL_MODULES_PATH}/s3-request-presigner`;

console.log('=== Тестирование локальных модулей AWS SDK ===');

// Проверка наличия модулей
const fs = require('fs');

if (!fs.existsSync(S3_CLIENT_PATH)) {
  console.error(`Ошибка: Модуль ${S3_CLIENT_PATH} не найден!`);
  process.exit(1);
}

if (!fs.existsSync(PRESIGNER_PATH)) {
  console.error(`Ошибка: Модуль ${PRESIGNER_PATH} не найден!`);
  process.exit(1);
}

console.log('Модули найдены, пытаемся импортировать...');

try {
  // Импорт основных классов из локальных модулей
  const { S3Client, PutObjectCommand } = require(S3_CLIENT_PATH);
  const { getSignedUrl } = require(PRESIGNER_PATH);
  
  console.log('Модули успешно импортированы!');
  
  // Проверяем создание клиента
  const s3Client = new S3Client({
    region: 'ru-1',
    endpoint: 'https://s3.ru1.storage.beget.cloud',
    credentials: {
      accessKeyId: process.env.BEGET_S3_ACCESS_KEY || 'test-key',
      secretAccessKey: process.env.BEGET_S3_SECRET_KEY || 'test-secret'
    },
    forcePathStyle: true
  });
  
  console.log('S3Client успешно создан!');
  
  // Проверяем создание команды
  const command = new PutObjectCommand({
    Bucket: 'test-bucket',
    Key: 'test-key',
    Body: 'test-content',
    ContentType: 'text/plain'
  });
  
  console.log('PutObjectCommand успешно создан!');
  
  // Проверяем наличие всех необходимых классов и методов
  console.log('\nПроверка доступных классов и методов:');
  
  // Проверяем S3Client и команды
  console.log('- S3Client:', typeof S3Client === 'function' ? 'OK' : 'НЕ НАЙДЕН');
  console.log('- PutObjectCommand:', typeof PutObjectCommand === 'function' ? 'OK' : 'НЕ НАЙДЕН');
  
  // Проверяем методы подписи URL
  console.log('- getSignedUrl:', typeof getSignedUrl === 'function' ? 'OK' : 'НЕ НАЙДЕН');
  
  console.log('\nВсе необходимые классы и методы найдены!');
  console.log('\n=== Тестирование успешно завершено ===');
  
} catch (error) {
  console.error('Ошибка при импорте модулей:', error);
  process.exit(1);
}