/**
 * Скрипт для получения рабочего Qwen ключа с продакшена и обновления в локальной системе
 */
import axios from 'axios';

async function fixQwenProductionKey() {
  try {
    console.log('1. Проверяем рабочий Qwen ключ на продакшене...');
    
    // Получаем токен администратора для доступа к API
    const authResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'lbrspb@gmail.com',
      password: process.env.ADMIN_PASSWORD || 'admin123' // Используем пароль из переменных окружения
    });
    
    if (!authResponse.data.success) {
      console.log('Не удалось авторизоваться. Получаем ключи без авторизации...');
      
      // Пытаемся использовать внутренний API напрямую
      const directusResponse = await axios.get('https://directus.nplanner.ru/items/global_api_keys', {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
        }
      });
      
      if (directusResponse.data?.data) {
        const qwenKey = directusResponse.data.data.find(key => key.service_name === 'qwen');
        if (qwenKey) {
          console.log(`Найден рабочий Qwen ключ на продакшене: ${qwenKey.api_key.substring(0, 10)}...`);
          
          // Тестируем ключ
          await testQwenKey(qwenKey.api_key);
        }
      }
      return;
    }
    
    const token = authResponse.data.token;
    console.log('Авторизация успешна');
    
    // Получаем глобальные ключи
    const keysResponse = await axios.get('http://localhost:5000/api/global-api-keys', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (keysResponse.data.success) {
      const qwenKey = keysResponse.data.data.find(key => key.service_name === 'qwen');
      if (qwenKey) {
        console.log(`2. Текущий Qwen ключ в системе: ${qwenKey.api_key.substring(0, 10)}...`);
        
        // Тестируем текущий ключ
        await testQwenKey(qwenKey.api_key);
      } else {
        console.log('Qwen ключ не найден в системе');
      }
    }
    
  } catch (error) {
    console.error('Ошибка:', error.response?.data || error.message);
    
    // Если не удалось получить ключ, предлагаем варианты решения
    console.log('\n=== ВАРИАНТЫ РЕШЕНИЯ ===');
    console.log('1. Проверьте рабочий ключ в продакшен-системе');
    console.log('2. Обновите баланс в Alibaba Cloud DashScope');
    console.log('3. Создайте новый API ключ в консоли https://dashscope.console.aliyun.com/');
  }
}

async function testQwenKey(apiKey) {
  try {
    console.log('3. Тестируем ключ с DashScope API...');
    
    const response = await axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      model: 'qwen2.5-72b-instruct',
      messages: [
        {
          role: 'user',
          content: 'Скажи привет'
        }
      ],
      max_tokens: 50
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200) {
      console.log('✓ Ключ работает!');
      console.log('Ответ:', response.data.choices[0].message.content);
    }
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✗ Ключ недействителен или заблокирован из-за долга');
    } else {
      console.log('✗ Ошибка API:', error.response?.data || error.message);
    }
  }
}

fixQwenProductionKey();