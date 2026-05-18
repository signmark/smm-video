/**
 * Тестирование интеграции Beget S3 с AWS SDK
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

async function testBegetS3Integration() {
  try {
    console.log('Starting Beget S3 integration test...');

    // Создаем тестовый файл
    const testContent = `Test file content generated at ${new Date().toISOString()}`;
    const testFilePath = path.join(__dirname, 'test-s3-file.txt');
    fs.writeFileSync(testFilePath, testContent);

    console.log(`Created test file at ${testFilePath}`);

    // Загружаем файл в S3
    const uploadResult = await begetS3StorageAws.uploadLocalFile(
      testFilePath,
      'test-ts-upload.txt',
      'text/plain',
      'tests'
    );

    if (!uploadResult.success) {
      throw new Error(`Failed to upload file: ${uploadResult.error}`);
    }

    console.log('File uploaded successfully!');
    console.log('File URL:', uploadResult.url);
    console.log('File key:', uploadResult.key);

    // Проверяем существование файла
    const exists = await begetS3StorageAws.fileExists(uploadResult.key!);
    console.log('File exists check:', exists);

    // Получаем список файлов
    const files = await begetS3StorageAws.listFiles('tests');
    console.log(`Files in 'tests' folder (${files.length}):`);
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });

    // Удаляем тестовый локальный файл
    fs.unlinkSync(testFilePath);
    console.log('Local test file deleted.');

    console.log('Beget S3 integration test completed successfully!');
  } catch (error) {
    console.error('Error during Beget S3 integration test:', error);
  }
}

// Запускаем тест
testBegetS3Integration().catch(console.error);