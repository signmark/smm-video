/**
 * Тестирование API через fetch
 */

import fetch from 'node-fetch';
import { begetS3StorageAws } from './server/services/beget-s3-storage-aws.js';

async function testBegetS3Api() {
  try {
    console.log('Тестирование API Beget S3...');
    
    // Тест подключения
    const connectionResponse = await fetch('http://localhost:5000/api/beget-s3/test-connection', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Статус ответа (test-connection):', connectionResponse.status);
    const connectionText = await connectionResponse.text();
    console.log('Текст ответа:', connectionText.substring(0, 200) + '...');
    
    // Проверяем, если ответ - HTML (содержит DOCTYPE или <html>)
    if (connectionText.includes('<!DOCTYPE html>') || connectionText.includes('<html>')) {
      console.log('ВНИМАНИЕ: Получен HTML-ответ вместо JSON. Проверьте настройки API маршрутов.');
    }

    // Тест загрузки файла
    const uploadResponse = await fetch('http://localhost:5000/api/beget-s3/test-upload', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Тестовое содержимое от ' + new Date().toISOString(),
        filename: 'test-api-' + Date.now() + '.txt'
      })
    });
    
    console.log('Статус ответа (test-upload):', uploadResponse.status);
    const uploadText = await uploadResponse.text();
    console.log('Текст ответа:', uploadText.substring(0, 200) + '...');
    
    // Проверяем прямую работу с AWS SDK
    console.log('\nПроверка прямого использования AWS SDK...');
    
    // Проверяем инициализацию
    console.log('Служба begetS3StorageAws инициализирована:', !!begetS3StorageAws);
    
    // Список файлов
    const files = await begetS3StorageAws.listFiles();
    console.log(`Получено ${files.length} файлов из бакета`);
    console.log('Первые 5 файлов:', files.slice(0, 5));
    
    // Загрузка тестового файла напрямую через SDK
    const uploadResult = await begetS3StorageAws.uploadContent(
      'Тестовое содержимое через SDK от ' + new Date().toISOString(),
      'sdk-test-' + Date.now() + '.txt',
      'text/plain'
    );
    
    console.log('Результат загрузки через SDK:', uploadResult);
    
    console.log('Тестирование API завершено!');
  } catch (error) {
    console.error('Ошибка при тестировании API:', error);
  }
}

testBegetS3Api();