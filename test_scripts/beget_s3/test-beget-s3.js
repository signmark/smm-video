/**
 * Тест для загрузки файла в Beget S3 через модифицированную реализацию AWS SDK
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { begetS3StorageAws } from './server/services/beget-s3-storage-aws.js';

// Создаем временный тестовый файл
const createTestFile = () => {
  const tempDir = os.tmpdir();
  const testFilePath = path.join(tempDir, `test-file-${Date.now()}.txt`);
  const content = `This is a test file for Beget S3 upload. Created at: ${new Date().toISOString()}`;
  
  fs.writeFileSync(testFilePath, content, 'utf8');
  console.log(`Created test file at: ${testFilePath}`);
  
  return testFilePath;
};

// Тестирует загрузку файла
const testUpload = async () => {
  try {
    // Проверяем наличие переменных окружения
    const { BEGET_S3_ACCESS_KEY, BEGET_S3_SECRET_KEY, BEGET_S3_BUCKET } = process.env;
    
    if (!BEGET_S3_ACCESS_KEY || !BEGET_S3_SECRET_KEY || !BEGET_S3_BUCKET) {
      console.error('Missing required environment variables. Make sure you have BEGET_S3_ACCESS_KEY, BEGET_S3_SECRET_KEY, and BEGET_S3_BUCKET defined.');
      return;
    }
    
    console.log('Environment variables found:', {
      BEGET_S3_ACCESS_KEY: BEGET_S3_ACCESS_KEY.slice(0, 3) + '***' + BEGET_S3_ACCESS_KEY.slice(-3),
      BEGET_S3_SECRET_KEY: BEGET_S3_SECRET_KEY.slice(0, 3) + '***' + BEGET_S3_SECRET_KEY.slice(-3),
      BEGET_S3_BUCKET
    });
    
    // Создаем тестовый файл
    const testFilePath = createTestFile();
    
    console.log('Starting upload to Beget S3...');
    
    // Загружаем файл
    const uploadResult = await begetS3StorageAws.uploadFile({
      filePath: testFilePath,
      key: `test-uploads/test-file-${Date.now()}.txt`,
      contentType: 'text/plain'
    });
    
    if (uploadResult.success) {
      console.log('Upload successful!');
      console.log('File URL:', uploadResult.url);
      
      // Пробуем доступиться к файлу через HTTP
      console.log('Checking file access...');
      try {
        const response = await fetch(uploadResult.url);
        if (response.ok) {
          const content = await response.text();
          console.log('File content successfully retrieved:');
          console.log(content);
        } else {
          console.error(`Failed to access file: ${response.status} ${response.statusText}`);
        }
      } catch (accessError) {
        console.error('Error accessing file:', accessError.message);
      }
    } else {
      console.error('Upload failed:', uploadResult.error);
    }
    
    // Очищаем тестовый файл
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
      console.log(`Deleted test file: ${testFilePath}`);
    }
    
  } catch (error) {
    console.error('Test failed with error:', error);
  }
};

// Запускаем тест
testUpload().then(() => {
  console.log('Test completed');
}).catch((error) => {
  console.error('Unhandled error in test:', error);
});