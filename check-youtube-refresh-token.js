/**
 * Проверка текущего YouTube refresh_token в базе данных
 * Ищем какой refresh_token используется в кампаниях
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech/';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function checkYouTubeRefreshTokens() {
  console.log('=== ПРОВЕРКА YOUTUBE REFRESH TOKENS ===\n');

  if (!DIRECTUS_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не настроен');
    return;
  }

  try {
    // Получаем все кампании с YouTube настройками
    console.log('🔍 Поиск кампаний с YouTube настройками...');
    const response = await fetch(`${DIRECTUS_URL}items/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });

    if (!response.ok) {
      console.error(`❌ Ошибка доступа к кампаниям: ${response.status}`);
      return;
    }

    const data = await response.json();
    const campaigns = data.data || [];

    console.log(`📊 Найдено ${campaigns.length} кампаний`);

    let youtubeCount = 0;
    let tokensFound = [];

    campaigns.forEach(campaign => {
      if (campaign.social_media_settings) {
        let settings;
        try {
          settings = typeof campaign.social_media_settings === 'string' 
            ? JSON.parse(campaign.social_media_settings) 
            : campaign.social_media_settings;
        } catch (e) {
          return;
        }

        if (settings.youtube) {
          youtubeCount++;
          console.log(`\n📋 Кампания: ${campaign.title || campaign.id}`);
          console.log(`   ID: ${campaign.id}`);
          
          const youtube = settings.youtube;
          console.log(`   API Key: ${youtube.apiKey ? 'присутствует' : 'отсутствует'}`);
          console.log(`   Channel ID: ${youtube.channelId || 'не указан'}`);
          console.log(`   Access Token: ${youtube.accessToken ? 'присутствует' : 'отсутствует'}`);
          console.log(`   Refresh Token: ${youtube.refreshToken ? 'присутствует' : 'отсутствует'}`);
          
          if (youtube.refreshToken) {
            console.log(`   Refresh Token (первые 20 символов): ${youtube.refreshToken.substring(0, 20)}...`);
            tokensFound.push({
              campaignId: campaign.id,
              campaignTitle: campaign.title,
              refreshToken: youtube.refreshToken
            });
          }
        }
      }
    });

    console.log(`\n📊 Статистика:`);
    console.log(`   Кампаний с YouTube: ${youtubeCount}`);
    console.log(`   Найдено refresh_token: ${tokensFound.length}`);

    if (tokensFound.length === 0) {
      console.log('\n❌ НЕ НАЙДЕНО REFRESH_TOKEN!');
      console.log('💡 Решение:');
      console.log('   1. Зайдите в любую кампанию');
      console.log('   2. Откройте "Социальные сети"');
      console.log('   3. Настройте YouTube OAuth заново');
      console.log('   4. Новый refresh_token сохранится автоматически');
    } else {
      console.log('\n✅ Найдены refresh_token:');
      tokensFound.forEach((token, index) => {
        console.log(`   ${index + 1}. ${token.campaignTitle} (${token.campaignId})`);
      });

      // Тестируем первый найденный токен
      const firstToken = tokensFound[0];
      console.log(`\n🧪 Тестируем refresh_token из кампании "${firstToken.campaignTitle}"...`);
      await testRefreshToken(firstToken.refreshToken);
    }

  } catch (error) {
    console.error('❌ Ошибка при проверке:', error.message);
  }
}

async function testRefreshToken(refreshToken) {
  const YOUTUBE_CLIENT_ID = '267968960436-f1fcdat2q3hrn029ine955v5d3t71b2k.apps.googleusercontent.com';
  const YOUTUBE_CLIENT_SECRET = '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';

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const result = await response.json();
    
    if (response.ok && result.access_token) {
      console.log('✅ REFRESH_TOKEN РАБОТАЕТ!');
      console.log(`🔑 Новый access_token получен: ${result.access_token.substring(0, 30)}...`);
      console.log(`⏰ Expires in: ${result.expires_in} секунд`);
    } else if (result.error === 'invalid_grant') {
      console.log('❌ REFRESH_TOKEN ИСТЕК или НЕДЕЙСТВИТЕЛЕН');
      console.log('💡 Нужно получить новый refresh_token через OAuth flow');
    } else {
      console.log('❓ Неожиданная ошибка:', result);
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании refresh_token:', error.message);
  }
}

checkYouTubeRefreshTokens();