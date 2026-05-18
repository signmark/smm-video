/**
 * Прямое обновление Qwen API ключа через внутренний API
 */
import axios from 'axios';

async function updateQwenKeyDirect() {
  try {
    console.log('Получение авторизации...');
    
    // Авторизуемся
    const authResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'lbrspb@gmail.com',
      password: 'lbrspb2024'
    });
    
    if (!authResponse.data.token) {
      console.error('Не удалось получить токен авторизации');
      return;
    }
    
    const token = authResponse.data.token;
    console.log('Токен получен, обновляем Qwen ключ...');
    
    // Получаем текущие ключи
    const globalKeysResponse = await axios.get('http://localhost:5000/api/global-api-keys', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const qwenKey = globalKeysResponse.data.find(key => key.service_name === 'qwen');
    
    if (qwenKey) {
      console.log(`Найден Qwen ключ с ID: ${qwenKey.id}`);
      
      // Обновляем правильным ключом
      const newKey = 'sk-e87a9ed470f44065b49176f7606d5428';
      
      const updateResponse = await axios.put(`http://localhost:5000/api/global-api-keys/${qwenKey.id}`, {
        api_key: newKey,
        service_name: 'qwen',
        is_active: true
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('Qwen ключ обновлен:', updateResponse.data);
      
      // Тестируем
      const testResponse = await axios.post('http://localhost:5000/api/qwen/improve-text', {
        text: 'Привет мир',
        prompt: 'Улучши этот текст',
        model: 'qwen2.5-72b-instruct'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (testResponse.data.success) {
        console.log('✓ Qwen API тест успешен');
        console.log('Результат:', testResponse.data.result);
      } else {
        console.log('✗ Qwen API тест неудачен:', testResponse.data.error);
      }
      
    } else {
      console.log('Qwen ключ не найден');
    }
    
  } catch (error) {
    console.error('Ошибка:', error.response?.data || error.message);
  }
}

updateQwenKeyDirect();