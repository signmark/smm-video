/**
 * Тестирование загрузки видео в Beget S3
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { begetS3StorageAws } from './server/services/beget-s3-storage-aws';

// Получаем текущую директорию в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config();

async function testVideoUpload() {
  try {
    console.log('Starting Beget S3 video upload test...');

    // Создаем тестовое текстовое содержимое, которое позже заменим на видео при необходимости
    const testContent = `Test video content placeholder generated at ${new Date().toISOString()}`;
    const testFilePath = path.join(__dirname, 'test-video.webm');
    fs.writeFileSync(testFilePath, testContent);

    console.log(`Created test file at ${testFilePath}`);

    // Загружаем файл в S3
    const uploadResult = await begetS3StorageAws.uploadLocalFile(
      testFilePath,
      'test-video-upload.webm',
      'video/webm',
      'videos'
    );

    if (!uploadResult.success) {
      throw new Error(`Failed to upload video: ${uploadResult.error}`);
    }

    console.log('Video uploaded successfully!');
    console.log('Video URL:', uploadResult.url);
    console.log('Video key:', uploadResult.key);

    // Проверяем существование файла
    const exists = await begetS3StorageAws.fileExists(uploadResult.key!);
    console.log('File exists check:', exists);

    // Удаляем тестовый локальный файл
    fs.unlinkSync(testFilePath);
    console.log('Local test file deleted.');

    // Получаем список видео файлов
    const files = await begetS3StorageAws.listFiles('videos');
    console.log(`Files in 'videos' folder (${files.length}):`);
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });

    console.log('Beget S3 video upload test completed successfully!');
  } catch (error) {
    console.error('Error during Beget S3 video upload test:', error);
  }
}

// Запускаем тест
testVideoUpload().catch(console.error);