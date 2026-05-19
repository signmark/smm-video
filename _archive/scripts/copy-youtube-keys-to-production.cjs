/**
 * Скрипт для копирования YouTube API ключей со стейджа на продакшен
 */

const axios = require('axios');

async function copyYouTubeKeysToProduction() {
  try {
    console.log('🔄 Копируем YouTube API ключи на продакшен...');
    
    // Настройки для стейджа (источник)
    const stagingUrl = process.env.STAGING_DIRECTUS_URL || 'https://staging-directus.nplanner.ru';
    const stagingToken = process.env.STAGING_DIRECTUS_TOKEN;
    
    // Настройки для продакшена (назначение)
    const productionUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const productionToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    
    if (!stagingToken) {
      console.error('❌ Отсутствует STAGING_DIRECTUS_TOKEN');
      return;
    }
    
    if (!productionToken) {
      console.error('❌ Отсутствует DIRECTUS_TOKEN или DIRECTUS_ADMIN_TOKEN для продакшена');
      return;
    }
    
    console.log('📥 Получаем YouTube ключи со стейджа...');
    
    // Получаем YouTube ключи со стейджа
    const stagingResponse = await axios.get(`${stagingUrl}/items/global_api_keys`, {
      params: {
        fields: ['service_name', 'api_key', 'is_active'],
        filter: {
          service_name: { _in: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'] },
          is_active: { _eq: true }
        }
      },
      headers: {
        Authorization: `Bearer ${stagingToken}`
      }
    });
    
    const stagingKeys = stagingResponse.data?.data || [];
    console.log(`✅ Найдено ${stagingKeys.length} YouTube ключей на стейдже`);
    
    if (stagingKeys.length === 0) {
      console.log('⚠️ YouTube ключи не найдены на стейдже');
      return;
    }
    
    console.log('📤 Добавляем ключи на продакшен...');
    
    // Добавляем ключи на продакшен
    for (const keyData of stagingKeys) {
      try {
        // Проверяем, существует ли уже ключ на продакшене
        const existingResponse = await axios.get(`${productionUrl}/items/global_api_keys`, {
          params: {
            filter: {
              service_name: { _eq: keyData.service_name }
            }
          },
          headers: {
            Authorization: `Bearer ${productionToken}`
          }
        });
        
        if (existingResponse.data.data.length > 0) {
          // Обновляем существующий
          const existingId = existingResponse.data.data[0].id;
          await axios.patch(`${productionUrl}/items/global_api_keys/${existingId}`, {
            api_key: keyData.api_key,
            is_active: keyData.is_active,
            updated_at: new Date().toISOString()
          }, {
            headers: {
              Authorization: `Bearer ${productionToken}`
            }
          });
          console.log(`✅ Обновлен ключ: ${keyData.service_name}`);
        } else {
          // Создаем новый
          await axios.post(`${productionUrl}/items/global_api_keys`, {
            service_name: keyData.service_name,
            api_key: keyData.api_key,
            is_active: keyData.is_active,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            headers: {
              Authorization: `Bearer ${productionToken}`
            }
          });
          console.log(`✅ Создан новый ключ: ${keyData.service_name}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка при обработке ${keyData.service_name}:`, error.response?.data || error.message);
      }
    }
    
    console.log('🎉 YouTube API ключи успешно скопированы на продакшен!');
    console.log('🔄 Перезапустите продакшен сервер для применения изменений');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// Запускаем если вызван напрямую
if (require.main === module) {
  copyYouTubeKeysToProduction();
}

module.exports = { copyYouTubeKeysToProduction };