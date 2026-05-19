/**
 * Прямой тест YouTube OAuth без N8N
 * Проверяем работают ли наши credentials с реальным refresh_token
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/+$/, '') || 'https://directus.roboflow.tech';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function testYouTubeOAuthDirect() {
  console.log('=== ПРЯМОЙ ТЕСТ YOUTUBE OAUTH ===\n');

  try {
    // Получаем YouTube credentials из Directus
    console.log('🔍 Получаем YouTube credentials из Directus...');
    const response = await fetch(`${DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    const data = await response.json();
    const records = data.data || [];

    // Ищем YouTube запись
    let clientId = null;
    let clientSecret = null;

    const youtubeRecord = records.find(r => r.service_name === 'YouTube');
    if (youtubeRecord) {
      clientId = youtubeRecord.api_key;
      clientSecret = youtubeRecord.api_secret;
      console.log('✅ Найдена объединенная запись YouTube');
    } else {
      // Fallback на отдельные записи
      const clientIdRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_ID');
      const clientSecretRecord = records.find(r => r.service_name === 'YOUTUBE_CLIENT_SECRET');
      
      if (clientIdRecord && clientSecretRecord) {
        clientId = clientIdRecord.api_key;
        clientSecret = clientSecretRecord.api_key;
        console.log('✅ Найдены отдельные записи YouTube credentials');
      }
    }

    if (!clientId || !clientSecret) {
      console.error('❌ YouTube credentials не найдены');
      return;
    }

    console.log(`📋 Client ID: ${clientId}`);
    console.log(`📋 Client Secret: ${clientSecret ? 'присутствует' : 'отсутствует'}`);

    // Тестируем credentials с фиктивным refresh_token
    console.log('\n🧪 Тестируем credentials с Google OAuth API...');
    
    const oauthResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: 'test_invalid_token',
        grant_type: 'refresh_token'
      })
    });

    const oauthResult = await oauthResponse.json();
    
    console.log(`📊 OAuth ответ статус: ${oauthResponse.status}`);
    console.log(`📄 OAuth ответ:`, oauthResult);

    if (oauthResult.error === 'invalid_client') {
      console.error('❌ ОШИБКА: invalid_client - credentials неправильные!');
    } else if (oauthResult.error === 'invalid_grant') {
      console.log('✅ УСПЕХ: Credentials правильные, проблема только в refresh_token');
    } else {
      console.log('⚠️ Неожиданный ответ от Google OAuth API');
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
  }
}

// Запускаем тест
testYouTubeOAuthDirect();