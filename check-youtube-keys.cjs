/**
 * Скрипт для проверки YouTube API ключей в базе данных
 */

const axios = require('axios');

async function checkYouTubeKeys(environment = 'production') {
  try {
    let directusUrl, token;
    
    if (environment === 'staging') {
      directusUrl = process.env.STAGING_DIRECTUS_URL || 'https://staging-directus.nplanner.ru';
      token = process.env.STAGING_DIRECTUS_TOKEN;
    } else {
      directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      token = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    }
    
    console.log(`🔍 Проверяем YouTube API ключи в ${environment}...`);
    console.log(`📡 URL: ${directusUrl}`);
    
    if (!token) {
      console.error(`❌ Отсутствует токен для ${environment}`);
      return;
    }
    
    // Получаем YouTube ключи
    const response = await axios.get(`${directusUrl}/items/global_api_keys`, {
      params: {
        fields: ['id', 'service_name', 'api_key', 'is_active', 'created_at'],
        filter: {
          service_name: { _in: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI'] }
        }
      },
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    const keys = response.data?.data || [];
    console.log(`📊 Найдено ${keys.length} YouTube записей в ${environment}`);
    
    if (keys.length === 0) {
      console.log('❌ YouTube ключи отсутствуют!');
      return;
    }
    
    keys.forEach(key => {
      console.log(`✅ ${key.service_name}: ${key.is_active ? 'АКТИВЕН' : 'НЕАКТИВЕН'} (${key.api_key ? 'есть значение' : 'пустое значение'})`);
    });
    
    // Проверяем обязательные ключи
    const requiredKeys = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'];
    const foundKeys = keys.filter(k => k.is_active && k.api_key).map(k => k.service_name);
    const missingKeys = requiredKeys.filter(k => !foundKeys.includes(k));
    
    if (missingKeys.length === 0) {
      console.log('🎉 Все необходимые YouTube ключи найдены и активны!');
    } else {
      console.log(`❌ Отсутствуют ключи: ${missingKeys.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при проверке:', error.response?.data || error.message);
  }
}

// Проверяем оба окружения если вызван напрямую
if (require.main === module) {
  (async () => {
    await checkYouTubeKeys('production');
    console.log('---');
    await checkYouTubeKeys('staging');
  })();
}

module.exports = { checkYouTubeKeys };