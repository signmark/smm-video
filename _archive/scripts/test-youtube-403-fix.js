/**
 * Тест исправления YouTube 403 ошибки для миниатюр
 * Проверяет обработку ошибки "upload and set custom video thumbnails"
 */

console.log('🔧 Тестирование исправления YouTube 403 ошибки для миниатюр...');

// Симуляция данных контента с видео и миниатюрой
const testContent = {
  id: 'test-youtube-403-fix',
  title: 'Тест исправления 403 ошибки миниатюр',
  content: 'Тестовое видео для проверки обработки 403 ошибки при загрузке кастомных миниатюр на неверифицированном YouTube канале',
  video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/8ab96949-ebdf-4aa0-b262-9da4be6a2715-mov_bbb.mp4',
  videoThumbnail: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/thumbnails/5cbc3d14-d3b9-4876-b0d5-c68fe3027c15.jpg',
  campaign_id: 'test-campaign-id'
};

const testCampaignSettings = {
  youtube: {
    accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    channelId: process.env.YOUTUBE_CHANNEL_ID
  }
};

async function testYouTube403Fix() {
  try {
    console.log('📋 Данные для теста:');
    console.log('- Video URL:', testContent.video_url);
    console.log('- Thumbnail URL:', testContent.videoThumbnail);
    console.log('- Title:', testContent.title);
    
    // Импортируем YouTube сервис
    const { YouTubeService } = await import('./server/services/social-platforms/youtube-service.js');
    const youtubeService = new YouTubeService();
    
    console.log('🚀 Начинаем тест YouTube публикации с обработкой 403 ошибки...');
    
    const result = await youtubeService.publishContent(
      testContent,
      testCampaignSettings,
      'test-user-id'
    );
    
    console.log('📊 Результат публикации:');
    console.log('- Success:', result.success);
    console.log('- Post URL:', result.postUrl);
    console.log('- Error:', result.error);
    console.log('- Quota Exceeded:', result.quotaExceeded);
    
    if (result.success) {
      console.log('✅ Тест прошел успешно! Видео опубликовано:', result.postUrl);
      
      // Проверяем, была ли обработана ошибка миниатюры в логах
      console.log('📝 Проверьте логи на наличие сообщений:');
      console.log('- "ПРЕДУПРЕЖДЕНИЕ: Канал не имеет прав для загрузки кастомных миниатюр"');
      console.log('- "Для загрузки кастомных миниатюр необходимо: 1) Верифицировать канал"');
      
    } else if (result.error && result.error.includes('upload and set custom video thumbnails')) {
      console.log('❌ Ошибка 403 для миниатюр НЕ была обработана корректно');
      console.log('🔧 Нужно проверить обработку ошибок в YouTube service');
      
    } else {
      console.log('ℹ️ Публикация не удалась по другой причине:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
    console.error('📊 Детали ошибки:', error);
  }
}

async function testN8NWorkflow403Fix() {
  console.log('🔧 Тестирование N8N workflow для обработки 403 ошибки...');
  
  try {
    const n8nUrl = process.env.N8N_URL || 'https://n8n.roboflow.space';
    const webhookUrl = `${n8nUrl}/webhook/publish-youtube`;
    
    const payload = {
      contentId: testContent.id,
      platform: 'youtube'
    };
    
    console.log('📤 Отправляем запрос в N8N workflow:', webhookUrl);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    console.log('📊 Статус ответа N8N:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('📋 Результат N8N workflow:');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.warning && result.warning.includes('кастомной миниатюры')) {
        console.log('✅ N8N workflow корректно обработал ошибку 403 для миниатюр!');
      } else if (result.success) {
        console.log('✅ N8N workflow выполнился успешно');
      }
      
    } else {
      const errorText = await response.text();
      console.log('❌ N8N workflow вернул ошибку:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании N8N workflow:', error.message);
  }
}

// Запускаем тесты
console.log('🎯 ТЕСТ 1: Прямой YouTube Service');
testYouTube403Fix().then(() => {
  console.log('\n🎯 ТЕСТ 2: N8N Workflow');
  return testN8NWorkflow403Fix();
}).then(() => {
  console.log('\n✅ Тестирование завершено!');
  console.log('📝 Для полного теста нужен YouTube канал БЕЗ верификации');
  console.log('📝 На верифицированном канале ошибка 403 для миниатюр не возникнет');
}).catch(error => {
  console.error('❌ Критическая ошибка при тестировании:', error);
});