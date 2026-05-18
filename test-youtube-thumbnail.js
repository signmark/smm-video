/**
 * Тест YouTube публикации с обложкой
 */

async function testYouTubeWithThumbnail() {
  try {
    console.log('🎬 Тестируем YouTube публикацию с обложкой...');
    
    const testData = {
      content: {
        id: 'test-youtube-thumbnail',
        title: 'Тест видео с обложкой',
        content: 'Описание тестового видео для проверки загрузки обложки на YouTube',
        video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/8ab96949-ebdf-4aa0-b262-9da4be6a2715-mov_bbb.mp4',
        videoThumbnail: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/thumbnails/5cbc3d14-d3b9-4876-b0d5-c68fe3027c15.jpg',
        user_id: 'test-user'
      },
      campaignSettings: {
        youtube: {
          apiKey: process.env.YOUTUBE_API_KEY,
          channelId: process.env.YOUTUBE_CHANNEL_ID,
          accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
          refreshToken: process.env.YOUTUBE_REFRESH_TOKEN
        }
      },
      userId: 'test-user'
    };
    
    // Импортируем YouTube сервис
    const { YouTubeService } = await import('./server/services/social-platforms/youtube-service.js');
    const youtubeService = new YouTubeService();
    
    console.log('📝 Данные для теста:');
    console.log('- Video URL:', testData.content.video_url);
    console.log('- Thumbnail URL:', testData.content.videoThumbnail);
    console.log('- Title:', testData.content.title);
    
    const result = await youtubeService.publishContent(
      testData.content,
      testData.campaignSettings,
      testData.userId
    );
    
    console.log('📊 Результат:', result);
    
    if (result.success) {
      console.log('✅ Тест прошел успешно!');
      console.log('🔗 URL видео:', result.postUrl);
    } else {
      console.log('❌ Тест провалился:', result.error);
    }
    
  } catch (error) {
    console.error('💥 Ошибка теста:', error.message);
  }
}

// Проверяем переменные окружения
if (!process.env.YOUTUBE_ACCESS_TOKEN) {
  console.log('❌ Отсутствуют YouTube токены, тест невозможен');
  console.log('Убедитесь, что настроены переменные:');
  console.log('- YOUTUBE_ACCESS_TOKEN');
  console.log('- YOUTUBE_REFRESH_TOKEN');
  console.log('- YOUTUBE_CLIENT_ID');
  console.log('- YOUTUBE_CLIENT_SECRET');
} else {
  testYouTubeWithThumbnail();
}