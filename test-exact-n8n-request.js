/**
 * Тест точно такого же запроса как делает N8N workflow
 * Проверяем полную цепочку данных
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech/';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function testExactN8NRequest() {
  console.log('=== ТЕСТ ТОЧНО ТАКОГО ЖЕ ЗАПРОСА КАК N8N ===\n');

  try {
    // Шаг 1: Получаем credentials как в N8N (SELECT * FROM global_api_keys)
    console.log('🔍 Шаг 1: Получаем credentials из global_api_keys...');
    
    const credentialsResponse = await fetch(`${DIRECTUS_URL}items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    const credentialsData = await credentialsResponse.json();
    const youtubeCredentials = credentialsData.data?.find(r => r.service_name === 'YouTube');
    
    if (!youtubeCredentials) {
      console.error('❌ YouTube credentials не найдены в global_api_keys');
      return;
    }

    console.log('✅ YouTube credentials найдены:');
    console.log(`   Client ID: ${youtubeCredentials.api_key}`);
    console.log(`   Client Secret: ${youtubeCredentials.api_secret ? 'присутствует' : 'отсутствует'}`);

    // Шаг 2: Получаем campaign settings как в N8N
    // Используем известную кампанию с YouTube настройками
    const campaignId = '46868c44-c6a4-4bed-accf-9ad07bba790e';
    
    console.log(`\n🔍 Шаг 2: Получаем настройки кампании ${campaignId}...`);
    
    const campaignResponse = await fetch(`${DIRECTUS_URL}items/user_campaigns/${campaignId}`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    const campaignData = await campaignResponse.json();
    const campaign = campaignData.data;
    
    if (!campaign || !campaign.social_media_settings) {
      console.error('❌ Кампания или настройки не найдены');
      return;
    }

    // Парсим social_media_settings как в N8N
    let settings;
    try {
      settings = typeof campaign.social_media_settings === 'string' 
        ? JSON.parse(campaign.social_media_settings) 
        : campaign.social_media_settings;
    } catch (e) {
      console.error('❌ Ошибка парсинга social_media_settings:', e.message);
      return;
    }

    console.log('✅ Campaign settings получены');
    console.log(`   YouTube настройки: ${settings.youtube ? 'присутствуют' : 'отсутствуют'}`);

    if (!settings.youtube) {
      console.error('❌ YouTube настройки отсутствуют в кампании');
      return;
    }

    const youtubeSettings = settings.youtube;
    console.log(`   Access Token: ${youtubeSettings.accessToken ? 'присутствует' : 'отсутствует'}`);
    console.log(`   Refresh Token: ${youtubeSettings.refreshToken ? 'присутствует' : 'отсутствует'}`);

    if (!youtubeSettings.refreshToken) {
      console.error('❌ Refresh token отсутствует в настройках кампании');
      return;
    }

    // Шаг 3: Делаем точно такой же OAuth запрос как N8N
    console.log('\n🧪 Шаг 3: Отправляем OAuth запрос к Google...');
    
    const requestData = {
      client_id: youtubeCredentials.api_key,
      client_secret: youtubeCredentials.api_secret,
      refresh_token: youtubeSettings.refreshToken,
      grant_type: 'refresh_token'
    };

    console.log('📋 Данные запроса:');
    console.log(`   client_id: ${requestData.client_id}`);
    console.log(`   client_secret: ${requestData.client_secret ? 'присутствует' : 'отсутствует'}`);
    console.log(`   refresh_token (20 символов): ${requestData.refresh_token.substring(0, 20)}...`);
    console.log(`   grant_type: ${requestData.grant_type}`);

    const oauthResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(requestData)
    });

    const oauthResult = await oauthResponse.json();

    console.log(`\n📊 OAuth ответ статус: ${oauthResponse.status}`);
    console.log('📄 OAuth ответ:');
    console.log(JSON.stringify(oauthResult, null, 2));

    if (oauthResponse.ok && oauthResult.access_token) {
      console.log('\n✅ УСПЕХ: OAuth запрос прошел успешно!');
      console.log('🎉 N8N должен работать с такими же данными');
      console.log('\n💡 Проблема в N8N workflow может быть в:');
      console.log('   1. Неправильном парсинге JSON из social_media_settings');
      console.log('   2. Передаче данных между узлами N8N');
      console.log('   3. Кэшировании старых данных в N8N');
    } else {
      console.log('\n❌ ОШИБКА: OAuth запрос не прошел');
      console.log('🔍 Нужно проверить логику N8N workflow');
    }

  } catch (error) {
    console.error('\n❌ Ошибка при тестировании:', error.message);
  }
}

testExactN8NRequest();