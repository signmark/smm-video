const axios = require('axios');

async function testStoriesWithImageUrl() {
  console.log('🎬 ТЕСТ: Instagram Stories с image_url fix');
  
  // Тестируем видео которое точно доступно
  const videoUrl = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4';
  
  const payload = {
    contentId: `stories_imageurl_fix_${Date.now()}`,
    contentType: 'video_story',
    platforms: ['instagram'],
    scheduledAt: new Date().toISOString(),
    
    // Правильная конфигурация с image_url
    instagram_config: {
      media_type: 'VIDEO',
      published: false, // Двухэтапный процесс
      api_version: 'v18.0',
      
      container_parameters: {
        image_url: videoUrl, // ИСПОЛЬЗУЕМ image_url для Stories видео!
        media_type: 'VIDEO',
        published: false
      },
      
      publish_parameters: {
        creation_id: '{{CONTAINER_ID}}'
      },
      
      use_existing_stories_workflow: true,
      workflow_type: 'instagram_stories'
    },
    
    content: {
      title: 'Stories image_url fix',
      description: 'Тест с image_url вместо video_url',
      videoUrl: videoUrl,
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    
    metadata: {
      converted: true,
      videoFormat: 'mp4',
      resolution: '1080x1920',
      codec: 'H.264'
    },
    
    // Дублируем параметры для N8N
    media_type: 'VIDEO',
    video_url: videoUrl,
    image_url: videoUrl, // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
    publish_mode: 'instagram_stories'
  };
  
  console.log('📋 PAYLOAD с image_url для Stories:');
  console.log(JSON.stringify(payload, null, 2));
  
  try {
    console.log('\n🚀 Отправляем запрос с image_url fix...');
    
    const response = await axios.post('https://n8n.nplanner.ru/webhook/publish-instagram-stories', payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('\n✅ N8N webhook принял запрос!');
    console.log('Status:', response.status);
    console.log('Response:', response.data || '""');
    
    console.log('\n🔍 ВАЖНО: Проверьте N8N execution logs');
    console.log('Если все еще падает:');
    console.log('1. N8N workflow может использовать image_url поле для видео Stories');
    console.log('2. Возможно нужны дополнительные headers или параметры');
    console.log('3. Instagram может требовать другой формат видео');
    
  } catch (error) {
    console.log('\n❌ ОШИБКА В ТЕСТЕ:');
    console.log('Status:', error.response?.status || 'No status');
    console.log('Error details:', error.response?.data || error.message);
    
    console.log('\n🔧 Дальнейшие шаги:');
    console.log('1. Проверить N8N execution logs на точную ошибку Instagram API');
    console.log('2. Возможно Instagram Stories требует специальный endpoint');
    console.log('3. Проверить права доступа токена для Stories');
  }
}

testStoriesWithImageUrl();