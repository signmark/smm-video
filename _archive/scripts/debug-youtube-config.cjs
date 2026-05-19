/**
 * Отладка получения YouTube конфигурации
 */

const axios = require('axios');

async function debugYouTubeConfig() {
  try {
    console.log('🔍 Отладка YouTube конфигурации...');
    
    // Проверяем переменные окружения
    const directusUrl = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_URL;
    const directusToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    
    console.log('📝 Переменные окружения:');
    console.log(`DIRECTUS_URL: ${directusUrl || 'НЕ ЗАДАН'}`);
    console.log(`DIRECTUS_TOKEN: ${directusToken ? 'ЕСТЬ' : 'НЕ ЗАДАН'}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'НЕ ЗАДАН'}`);
    
    if (!directusUrl || !directusToken) {
      console.error('❌ Отсутствуют обязательные переменные окружения');
      return;
    }
    
    // Тестируем подключение к API
    console.log('\n🌐 Тестируем подключение к Directus API...');
    
    try {
      const testResponse = await axios.get(`${directusUrl}/server/info`, {
        headers: {
          Authorization: `Bearer ${directusToken}`
        }
      });
      console.log('✅ Подключение к Directus успешно');
      console.log(`Версия Directus: ${testResponse.data?.data?.directus?.version || 'неизвестно'}`);
    } catch (error) {
      console.error('❌ Ошибка подключения к Directus:', error.response?.status, error.response?.statusText);
      return;
    }
    
    // Получаем YouTube ключи
    console.log('\n🔑 Получаем YouTube ключи...');
    
    const response = await axios.get(`${directusUrl}/items/global_api_keys`, {
      params: {
        fields: ['service_name', 'api_key', 'is_active'],
        filter: {
          service_name: { _in: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI'] },
          is_active: { _eq: true }
        }
      },
      headers: {
        Authorization: `Bearer ${directusToken}`
      }
    });
    
    const apiKeys = response.data?.data || [];
    console.log(`📊 Получено ${apiKeys.length} YouTube ключей`);
    
    if (apiKeys.length === 0) {
      console.log('❌ YouTube ключи не найдены или неактивны');
      
      // Попробуем получить все ключи без фильтра
      console.log('\n🔍 Проверяем все глобальные ключи...');
      const allKeysResponse = await axios.get(`${directusUrl}/items/global_api_keys`, {
        params: {
          fields: ['service_name', 'is_active']
        },
        headers: {
          Authorization: `Bearer ${directusToken}`
        }
      });
      
      const allKeys = allKeysResponse.data?.data || [];
      console.log(`📋 Всего глобальных ключей: ${allKeys.length}`);
      
      const youtubeKeys = allKeys.filter(k => k.service_name?.includes('YOUTUBE'));
      console.log(`🎥 YouTube ключей найдено: ${youtubeKeys.length}`);
      
      youtubeKeys.forEach(key => {
        console.log(`   - ${key.service_name}: ${key.is_active ? 'активен' : 'неактивен'}`);
      });
      
    } else {
      console.log('✅ YouTube ключи найдены:');
      apiKeys.forEach(key => {
        console.log(`   - ${key.service_name}: ${key.api_key ? 'есть значение' : 'пустое'}`);
      });
      
      // Проверяем конфигурацию
      const config = {};
      for (const keyData of apiKeys) {
        switch (keyData.service_name) {
          case 'YOUTUBE_CLIENT_ID':
            config.clientId = keyData.api_key;
            break;
          case 'YOUTUBE_CLIENT_SECRET':
            config.clientSecret = keyData.api_key;
            break;
          case 'YOUTUBE_REDIRECT_URI':
            config.redirectUri = keyData.api_key;
            break;
        }
      }
      
      console.log('\n⚙️ Сформированная конфигурация:');
      console.log(`Client ID: ${config.clientId ? 'ЕСТЬ' : 'ОТСУТСТВУЕТ'}`);
      console.log(`Client Secret: ${config.clientSecret ? 'ЕСТЬ' : 'ОТСУТСТВУЕТ'}`);
      console.log(`Redirect URI: ${config.redirectUri || 'не задан'}`);
      
      if (!config.clientId || !config.clientSecret) {
        console.log('❌ Неполная конфигурация YouTube');
      } else {
        console.log('✅ Конфигурация YouTube полная');
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('🔐 Проблема с авторизацией - проверьте DIRECTUS_TOKEN');
    }
  }
}

// Запускаем если вызван напрямую
if (require.main === module) {
  debugYouTubeConfig();
}

module.exports = { debugYouTubeConfig };