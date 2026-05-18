/**
 * Скрипт для исправления структуры YouTube credentials в global_api_keys
 * Объединяет YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в одну запись "YouTube"
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/+$/, '') || 'https://directus.roboflow.tech';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function fixYouTubeCredentials() {
  console.log('=== ИСПРАВЛЕНИЕ YOUTUBE CREDENTIALS ===\n');

  if (!DIRECTUS_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не настроен');
    return;
  }

  try {
    // Получаем все записи global_api_keys
    console.log('🔍 Получаем текущие записи global_api_keys...');
    const response = await fetch(`${DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    const data = await response.json();
    const records = data.data || [];

    // Ищем YouTube данные
    const clientIdRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_ID');
    const clientSecretRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_SECRET');
    const youtubeRecord = records.find(r => r.service_name === 'YouTube');

    if (!clientIdRecord || !clientSecretRecord) {
      console.error('❌ Не найдены YOUTUBE_CLIENT_ID или YOUTUBE_CLIENT_SECRET записи');
      return;
    }

    console.log('✅ Найдены YouTube credentials:');
    console.log(`   Client ID: ${clientIdRecord.api_key}`);
    console.log(`   Client Secret: ${clientSecretRecord.api_key}`);

    // Создаем или обновляем запись "YouTube"
    const youtubeData = {
      service_name: 'YouTube',
      api_key: clientIdRecord.api_key,
      api_secret: clientSecretRecord.api_key
    };

    if (youtubeRecord) {
      // Обновляем существующую запись
      console.log('\n📝 Обновляем существующую запись YouTube...');
      const updateResponse = await fetch(`${DIRECTUS_URL}/items/global_api_keys/${youtubeRecord.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(youtubeData)
      });

      if (updateResponse.ok) {
        console.log('✅ Запись YouTube успешно обновлена');
      } else {
        console.error('❌ Ошибка при обновлении записи YouTube');
      }
    } else {
      // Создаем новую запись
      console.log('\n📝 Создаем новую запись YouTube...');
      const createResponse = await fetch(`${DIRECTUS_URL}/items/global_api_keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(youtubeData)
      });

      if (createResponse.ok) {
        console.log('✅ Запись YouTube успешно создана');
      } else {
        console.error('❌ Ошибка при создании записи YouTube');
      }
    }

    // Проверяем результат
    console.log('\n🔍 Проверяем результат...');
    const checkResponse = await fetch(`${DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    const checkData = await checkResponse.json();
    const updatedYouTube = checkData.data?.find(r => r.service_name === 'YouTube');

    if (updatedYouTube) {
      console.log('✅ Запись YouTube найдена:');
      console.log(`   Service: ${updatedYouTube.service_name}`);
      console.log(`   API Key: ${updatedYouTube.api_key}`);
      console.log(`   API Secret: ${updatedYouTube.api_secret ? 'присутствует' : 'отсутствует'}`);
    } else {
      console.error('❌ Запись YouTube не найдена после обновления');
    }

  } catch (error) {
    console.error('❌ Ошибка при исправлении credentials:', error.message);
  }
}

// Запускаем исправление
fixYouTubeCredentials();