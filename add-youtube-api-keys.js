/**
 * Скрипт для добавления YouTube API ключей в продакшен базу данных
 */

const { DirectusAuth } = require('./server/services/directus-auth-manager');
const axios = require('axios');

async function addYouTubeApiKeys() {
  try {
    console.log('🔧 Добавляем YouTube API ключи в продакшен базу данных...');
    
    // Получаем системный токен
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@nplanner.ru';
    const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    if (!adminPassword) {
      console.error('❌ Отсутствует DIRECTUS_ADMIN_PASSWORD');
      return;
    }
    
    // Аутентификация
    const authResponse = await axios.post(`${directusUrl}/auth/login`, {
      email: adminEmail,
      password: adminPassword
    });
    
    const token = authResponse.data.data.access_token;
    console.log('✅ Получен системный токен');
    
    // YouTube API ключи (замените на реальные)
    const youtubeKeys = [
      {
        service_name: 'YOUTUBE_CLIENT_ID',
        api_key: 'YOUR_YOUTUBE_CLIENT_ID_HERE', // ЗАМЕНИТЕ НА РЕАЛЬНЫЙ
        is_active: true
      },
      {
        service_name: 'YOUTUBE_CLIENT_SECRET', 
        api_key: 'YOUR_YOUTUBE_CLIENT_SECRET_HERE', // ЗАМЕНИТЕ НА РЕАЛЬНЫЙ
        is_active: true
      }
    ];
    
    // Добавляем ключи
    for (const keyData of youtubeKeys) {
      try {
        // Проверяем, существует ли уже ключ
        const existingResponse = await axios.get(`${directusUrl}/items/global_api_keys`, {
          params: {
            filter: {
              service_name: { _eq: keyData.service_name }
            }
          },
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        if (existingResponse.data.data.length > 0) {
          // Обновляем существующий
          const existingId = existingResponse.data.data[0].id;
          await axios.patch(`${directusUrl}/items/global_api_keys/${existingId}`, {
            api_key: keyData.api_key,
            is_active: keyData.is_active,
            updated_at: new Date().toISOString()
          }, {
            headers: {
              Authorization: `Bearer ${token}`
            }
          });
          console.log(`✅ Обновлен ключ: ${keyData.service_name}`);
        } else {
          // Создаем новый
          await axios.post(`${directusUrl}/items/global_api_keys`, {
            ...keyData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            headers: {
              Authorization: `Bearer ${token}`
            }
          });
          console.log(`✅ Создан новый ключ: ${keyData.service_name}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка при обработке ${keyData.service_name}:`, error.response?.data || error.message);
      }
    }
    
    console.log('🎉 YouTube API ключи успешно добавлены!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// Запускаем если вызван напрямую
if (require.main === module) {
  addYouTubeApiKeys();
}

module.exports = { addYouTubeApiKeys };