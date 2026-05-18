/**
 * Тестовый скрипт для проверки работы с Beget S3 через локально загруженные модули AWS SDK
 */

// Устанавливаем пути к локальным модулям
const clientS3Path = './custom_modules/@aws-sdk/client-s3';
const presignerPath = './custom_modules/@aws-sdk/s3-request-presigner';

// Импортируем необходимые классы и функции
try {
  // Импортируем клиент S3 и команды
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require(clientS3Path);
  // Импортируем функцию для создания пресигнированных URL
  const { getSignedUrl } = require(presignerPath);

  // Настройки для подключения к Beget S3
  const s3Config = {
    region: process.env.BEGET_S3_REGION || 'ru-1',
    endpoint: process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
    credentials: {
      accessKeyId: process.env.BEGET_S3_ACCESS_KEY,
      secretAccessKey: process.env.BEGET_S3_SECRET_KEY
    },
    forcePathStyle: true
  };

  // Тестовые данные
  const testBucket = process.env.BEGET_S3_BUCKET;
  const testKey = `local-test/test-${Date.now()}.txt`;
  const testContent = `Тест локальных модулей AWS SDK: ${new Date().toISOString()}`;

  // Функция для чтения переменных окружения
  async function printEnvInfo() {
    console.log('\n=== Настройки Beget S3 ===');
    console.log(`BEGET_S3_REGION: ${process.env.BEGET_S3_REGION || 'ru-1'}`);
    console.log(`BEGET_S3_ENDPOINT: ${process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud'}`);
    console.log(`BEGET_S3_BUCKET: ${testBucket}`);
    console.log(`BEGET_S3_ACCESS_KEY: ${process.env.BEGET_S3_ACCESS_KEY ? '(установлен)' : '(не установлен)'}`);
    console.log(`BEGET_S3_SECRET_KEY: ${process.env.BEGET_S3_SECRET_KEY ? '(установлен)' : '(не установлен)'}`);
  }

  // Функция для загрузки файла
  async function uploadTestFile() {
    try {
      console.log('\n=== Загрузка тестового файла ===');
      
      // Создаем клиента S3
      const s3Client = new S3Client(s3Config);
      
      // Создаем команду для загрузки объекта
      const putCommand = new PutObjectCommand({
        Bucket: testBucket,
        Key: testKey,
        Body: testContent,
        ContentType: 'text/plain',
        ACL: 'public-read'
      });
      
      // Выполняем загрузку
      const result = await s3Client.send(putCommand);
      console.log('Результат загрузки:', result);
      
      // Формируем URL
      const publicUrl = `https://${testBucket}.${s3Config.endpoint.replace('https://', '')}/${testKey}`;
      console.log(`Файл успешно загружен: ${publicUrl}`);
      
      return publicUrl;
    } catch (error) {
      console.error('Ошибка загрузки файла:', error);
      throw error;
    }
  }

  // Функция для проверки существования файла
  async function checkFileExists() {
    try {
      console.log('\n=== Проверка существования файла ===');
      
      const s3Client = new S3Client(s3Config);
      
      const headCommand = new HeadObjectCommand({
        Bucket: testBucket,
        Key: testKey
      });
      
      // Отправляем HEAD-запрос для проверки существования
      const result = await s3Client.send(headCommand);
      console.log('Файл существует, метаданные:', result);
      return true;
    } catch (error) {
      console.error('Ошибка проверки файла:', error);
      return false;
    }
  }

  // Функция для получения пресигнированного URL
  async function getPresignedUrl() {
    try {
      console.log('\n=== Генерация пресигнированного URL ===');
      
      const s3Client = new S3Client(s3Config);
      
      const getCommand = new GetObjectCommand({
        Bucket: testBucket,
        Key: testKey
      });
      
      // Создаем пресигнированный URL
      const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      console.log(`Пресигнированный URL (действителен 1 час): ${presignedUrl}`);
      
      return presignedUrl;
    } catch (error) {
      console.error('Ошибка получения пресигнированного URL:', error);
      throw error;
    }
  }

  // Функция для запуска всех тестов
  async function runTests() {
    console.log('=== Начало тестирования AWS SDK с локальными модулями ===');
    
    // Выводим информацию о настройках
    await printEnvInfo();
    
    try {
      // Загружаем тестовый файл
      const fileUrl = await uploadTestFile();
      
      // Проверяем существование файла
      const exists = await checkFileExists();
      
      if (exists) {
        // Получаем пресигнированный URL
        await getPresignedUrl();
      }
      
      console.log('\nВсе тесты завершены успешно!');
    } catch (error) {
      console.error('\nТесты завершились с ошибкой:', error);
    }
    
    console.log('\n=== Тестирование завершено ===');
  }

  // Запускаем тесты
  runTests().catch(console.error);

} catch (error) {
  console.error('Ошибка при импорте модулей AWS SDK:', error);
  console.error('Убедитесь, что локальные модули корректно установлены в директории custom_modules/@aws-sdk/');
}