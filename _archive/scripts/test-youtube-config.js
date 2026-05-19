/**
 * Тестовый скрипт для проверки YouTube OAuth конфигурации
 */

const { GlobalApiKeysService } = require('./server/services/global-api-keys');

async function testYouTubeConfig() {
  try {
    console.log('🔍 Проверяем YouTube OAuth конфигурацию...');
    
    const globalApiKeysService = new GlobalApiKeysService();
    const youtubeConfig = await globalApiKeysService.getYouTubeConfig();
    
    if (youtubeConfig) {
      console.log('✅ YouTube конфигурация найдена:');
      console.log('- Client ID:', youtubeConfig.clientId ? `${youtubeConfig.clientId.substring(0, 20)}...` : 'НЕ НАЙДЕН');
      console.log('- Client Secret:', youtubeConfig.clientSecret ? `${youtubeConfig.clientSecret.substring(0, 10)}...` : 'НЕ НАЙДЕН');
      console.log('- Redirect URI:', youtubeConfig.redirectUri || 'НЕ УСТАНОВЛЕН (используется автоопределение)');
      
      // Проверяем автоопределение redirect URI
      const { YouTubeOAuth } = require('./server/utils/youtube-oauth');
      const oauth = new YouTubeOAuth(youtubeConfig);
      
      console.log('\n🔗 Тестируем генерацию auth URL...');
      const authUrl = oauth.getAuthUrl();
      console.log('Auth URL создан:', authUrl ? 'ДА' : 'НЕТ');
      
      if (authUrl) {
        // Извлекаем redirect_uri из auth URL
        const urlParams = new URL(authUrl);
        const redirectUri = urlParams.searchParams.get('redirect_uri');
        console.log('Фактический redirect URI в auth URL:', redirectUri);
      }
      
    } else {
      console.log('❌ YouTube конфигурация не найдена в базе данных');
      console.log('Проверьте наличие записи для платформы "YouTube" в таблице global_api_keys');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при проверке конфигурации:', error.message);
  }
}

testYouTubeConfig();