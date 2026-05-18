// Проверка API маршрутов для Beget S3
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

async function checkAPI() {
  try {
    console.log('=== Проверка API Beget S3 ===\n');

    // Проверка основного тестового маршрута
    console.log('1. Проверка маршрута /api/beget-s3/test');
    const testResponse = await axios.get(`${API_BASE}/beget-s3/test`);
    console.log('Статус:', testResponse.status);
    console.log('Данные:', JSON.stringify(testResponse.data, null, 2));
    console.log('\n');

    // Проверка маршрутов, которые могут существовать
    const routes = [
      { method: 'get', path: '/beget-s3/auth-status' },
      { method: 'get', path: '/beget-s3/bucket-info' },
      { method: 'post', path: '/beget-s3/upload-text' }
    ];

    for (const route of routes) {
      try {
        console.log(`${routes.indexOf(route) + 2}. Проверка маршрута ${route.method.toUpperCase()} ${API_BASE}${route.path}`);
        
        let response;
        if (route.method === 'get') {
          response = await axios.get(`${API_BASE}${route.path}`);
        } else if (route.method === 'post') {
          // Отправляем пустые данные для теста
          response = await axios.post(`${API_BASE}${route.path}`, {});
        }
        
        console.log('Статус:', response.status);
        console.log('Данные:', JSON.stringify(response.data, null, 2));
      } catch (error) {
        console.log('Ошибка:', error.message);
        if (error.response) {
          console.log('Статус ошибки:', error.response.status);
          console.log('Данные ошибки:', JSON.stringify(error.response.data, null, 2));
        }
      }
      console.log('\n');
    }

    console.log('=== Проверка завершена ===');
  } catch (error) {
    console.error('Произошла ошибка:', error.message);
  }
}

checkAPI();