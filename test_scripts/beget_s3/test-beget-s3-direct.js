/**
 * Тестирование прямой загрузки файла в Beget S3 без использования API маршрутов
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Инициализация переменных окружения
config();

// Получение текущей директории в ESM модуле
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testS3Upload() {
  try {
    // Динамический импорт сервиса (для поддержки ESM и TS)
    const { begetS3StorageAws } = await import('./server/services/beget-s3-storage-aws.js');
    
    console.log('Beget S3 Storage service loaded successfully.');
    console.log('Testing file upload...');
    
    // Путь к тестовому файлу
    const filePath = join(__dirname, 'test-s3-upload.txt');
    
    if (!existsSync(filePath)) {
      console.error(`Test file not found: ${filePath}`);
      return;
    }
    
    // Загружаем файл
    const result = await begetS3StorageAws.uploadLocalFile(
      filePath,
      'test-direct-upload.txt',
      'text/plain',
      'tests'
    );
    
    if (result.success) {
      console.log('File uploaded successfully!');
      console.log('URL:', result.url);
      console.log('Key:', result.key);
      
      // Проверяем существование файла
      const exists = await begetS3StorageAws.fileExists(result.key);
      console.log('File exists check:', exists);
      
      // Получаем список файлов
      const files = await begetS3StorageAws.listFiles('tests');
      console.log('Files in tests folder:', files);
    } else {
      console.error('Failed to upload file:', result.error);
    }
  } catch (error) {
    console.error('Error during S3 test:', error);
  }
}

// Запуск теста
testS3Upload().catch(console.error);