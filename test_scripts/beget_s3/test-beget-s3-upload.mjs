// Тест загрузки файла через API Beget S3
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:5000/api';

async function testFileUpload() {
  try {
    console.log('=== Тестирование загрузки файла через Beget S3 API ===\n');
    
    // Создаем временный текстовый файл
    const tempFileName = `test-file-${Date.now()}.txt`;
    const tempContent = `Тестовый файл для загрузки через Beget S3. Создан: ${new Date().toISOString()}`;
    
    // Загружаем текст через API
    console.log('Запрос на загрузку текста через API...');
    const uploadResponse = await axios.post(`${API_BASE}/beget-s3/upload-text`, {
      content: tempContent,
      filename: tempFileName,
      contentType: 'text/plain',
      folder: 'api-test'
    });
    
    console.log('Статус загрузки:', uploadResponse.status);
    console.log('Результат загрузки:', JSON.stringify(uploadResponse.data, null, 2));
    
    if (uploadResponse.data.url) {
      console.log('\nФайл успешно загружен по адресу:', uploadResponse.data.url);
      
      // Дополнительно можно проверить доступность файла
      try {
        console.log('\nПроверка доступности файла...');
        const fileResponse = await axios.get(uploadResponse.data.url);
        console.log('Файл доступен. Статус:', fileResponse.status);
        console.log('Содержимое файла:', fileResponse.data);
      } catch (error) {
        console.log('Ошибка при проверке файла:', error.message);
      }
    }
    
    console.log('\n=== Тестирование завершено ===');
  } catch (error) {
    console.error('Произошла ошибка:', error.message);
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Данные ошибки:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testFileUpload();