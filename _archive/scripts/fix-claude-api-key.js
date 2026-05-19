/**
 * Скрипт для настройки Claude API ключа в системе
 * Получает ключ из Directus Global API Keys и настраивает его для использования
 */

import axios from 'axios';

async function setupClaudeApiKey() {
  try {
    console.log('🔧 Настройка Claude API ключа...');
    
    // Получаем токен администратора - используем правильный порт и endpoint
    const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'lbrspb@gmail.com',
      password: 'lbrspb2024'
    });
    
    const token = loginResponse.data.token;
    console.log('✅ Авторизация администратора успешна');
    
    // Получаем список глобальных API ключей
    const keysResponse = await axios.get('http://localhost:5000/api/global-api-keys', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`📋 Получено ${keysResponse.data.length} глобальных API ключей`);
    
    // Ищем Claude ключ
    const claudeKey = keysResponse.data.find(key => 
      key.service_name === 'claude' && key.is_active
    );
    
    if (!claudeKey) {
      console.log('❌ Активный Claude ключ не найден в глобальных настройках');
      console.log('Доступные сервисы:', keysResponse.data.map(k => k.service_name));
      return;
    }
    
    console.log(`✅ Найден активный Claude ключ: ${claudeKey.api_key.substring(0, 8)}...`);
    
    // Тестируем Claude API ключ напрямую
    console.log('🧪 Тестирование Claude API ключа...');
    
    const testResponse = await axios.post('http://localhost:5000/api/claude/test-api-key', {
      apiKey: claudeKey.api_key
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (testResponse.data.success && testResponse.data.isValid) {
      console.log('✅ Claude API ключ работает корректно');
      
      // Теперь тестируем улучшение текста
      console.log('📝 Тестирование улучшения текста...');
      
      const improveResponse = await axios.post('http://localhost:5000/api/claude/improve-text', {
        text: 'Это тестовый текст для проверки функции улучшения.',
        prompt: 'Сделай этот текст более профессиональным и интересным',
        model: 'claude-3-sonnet-20240229'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (improveResponse.data.success) {
        console.log('✅ Функция улучшения текста работает!');
        console.log('📄 Результат:', improveResponse.data.text.substring(0, 100) + '...');
      } else {
        console.log('❌ Ошибка при улучшении текста:', improveResponse.data.error);
      }
      
    } else {
      console.log('❌ Claude API ключ не работает:', testResponse.data.error);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при настройке Claude API:', error.response?.data || error.message);
    
    if (error.response?.status === 500) {
      console.log('💡 Это может быть связано с неправильной конфигурацией сервера');
      console.log('   Проверьте, что сервер запущен и все сервисы доступны');
    }
  }
}

// Запускаем настройку
setupClaudeApiKey();