/**
 * Обновление YouTube credentials в ПРОДАКШЕН базе данных
 * N8N работает с production БД, поэтому нужно обновить там
 */

const PRODUCTION_DIRECTUS_URL = 'https://directus.nplanner.ru';
const PRODUCTION_DIRECTUS_TOKEN = process.env.DIRECTUS_PRODUCTION_TOKEN || process.env.DIRECTUS_TOKEN;

// Правильные YouTube credentials
const YOUTUBE_CLIENT_ID = '267968960436-f1fcdat2q3hrn029ine955v5d3t71b2k.apps.googleusercontent.com';
const YOUTUBE_CLIENT_SECRET = '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';

async function updateProductionYouTubeCredentials() {
  console.log('=== ОБНОВЛЕНИЕ YOUTUBE CREDENTIALS В ПРОДАКШЕНЕ ===\n');

  if (!PRODUCTION_DIRECTUS_TOKEN) {
    console.error('❌ PRODUCTION_DIRECTUS_TOKEN не настроен');
    console.log('Используйте: DIRECTUS_PRODUCTION_TOKEN=your_token node update-production-youtube-credentials.js');
    return;
  }

  try {
    // Получаем все записи global_api_keys из продакшена
    console.log('🔍 Получаем записи global_api_keys из продакшена...');
    const response = await fetch(`${PRODUCTION_DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`
      }
    });

    if (!response.ok) {
      console.error(`❌ Ошибка доступа к продакшену: ${response.status}`);
      const errorText = await response.text();
      console.error(errorText);
      return;
    }

    const data = await response.json();
    const records = data.data || [];

    console.log(`📊 Найдено ${records.length} записей в global_api_keys`);

    // Проверяем есть ли поле api_secret в схеме
    console.log('\n🔍 Проверяем схему таблицы global_api_keys...');
    const fieldsResponse = await fetch(`${PRODUCTION_DIRECTUS_URL}/fields/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`
      }
    });

    const fieldsData = await fieldsResponse.json();
    const fields = fieldsData.data || [];
    const hasApiSecretField = fields.some(f => f.field === 'api_secret');

    console.log(`📋 Поле api_secret ${hasApiSecretField ? 'существует' : 'НЕ существует'}`);

    // Если поля api_secret нет - создаем его
    if (!hasApiSecretField) {
      console.log('\n📝 Создаем поле api_secret...');
      const createFieldResponse = await fetch(`${PRODUCTION_DIRECTUS_URL}/fields/global_api_keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          field: 'api_secret',
          type: 'text',
          meta: {
            interface: 'input',
            note: 'API Secret or Client Secret for the service',
            required: false,
            width: 'half'
          }
        })
      });

      if (createFieldResponse.ok) {
        console.log('✅ Поле api_secret создано');
      } else {
        console.error('❌ Ошибка при создании поля api_secret');
      }
    }

    // Ищем существующие YouTube записи
    const youtubeRecord = records.find(r => r.service_name === 'YouTube');
    const clientIdRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_ID');
    const clientSecretRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_SECRET');

    console.log(`\n📋 YouTube записи:`);
    console.log(`   - YouTube: ${youtubeRecord ? 'найдена' : 'НЕ найдена'}`);
    console.log(`   - YOUTUBE_CLIENT_ID: ${clientIdRecord ? 'найдена' : 'НЕ найдена'}`);
    console.log(`   - YOUTUBE_CLIENT_SECRET: ${clientSecretRecord ? 'найдена' : 'НЕ найдена'}`);

    // Создаем или обновляем YouTube запись
    const youtubeData = {
      service_name: 'YouTube',
      api_key: YOUTUBE_CLIENT_ID,
      api_secret: YOUTUBE_CLIENT_SECRET,
      is_active: true
    };

    if (youtubeRecord) {
      // Обновляем существующую запись
      console.log('\n📝 Обновляем существующую запись YouTube...');
      const updateResponse = await fetch(`${PRODUCTION_DIRECTUS_URL}/items/global_api_keys/${youtubeRecord.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(youtubeData)
      });

      if (updateResponse.ok) {
        console.log('✅ Запись YouTube обновлена');
      } else {
        console.error('❌ Ошибка при обновлении YouTube записи');
      }
    } else {
      // Создаем новую запись
      console.log('\n📝 Создаем новую запись YouTube...');
      const createResponse = await fetch(`${PRODUCTION_DIRECTUS_URL}/items/global_api_keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(youtubeData)
      });

      if (createResponse.ok) {
        console.log('✅ Запись YouTube создана');
      } else {
        console.error('❌ Ошибка при создании YouTube записи');
      }
    }

    // Проверяем результат
    console.log('\n🔍 Проверяем обновленные данные...');
    const checkResponse = await fetch(`${PRODUCTION_DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${PRODUCTION_DIRECTUS_TOKEN}`
      }
    });

    const checkData = await checkResponse.json();
    const updatedYouTube = checkData.data?.find(r => r.service_name === 'YouTube');

    if (updatedYouTube) {
      console.log('✅ Обновленная запись YouTube:');
      console.log(`   Service: ${updatedYouTube.service_name}`);
      console.log(`   API Key: ${updatedYouTube.api_key}`);
      console.log(`   API Secret: ${updatedYouTube.api_secret ? 'присутствует' : 'отсутствует'}`);
      console.log('\n🎉 YouTube credentials успешно обновлены в продакшене!');
    } else {
      console.error('❌ Запись YouTube не найдена после обновления');
    }

  } catch (error) {
    console.error('❌ Ошибка при обновлении credentials:', error.message);
  }
}

// Запускаем обновление
updateProductionYouTubeCredentials();