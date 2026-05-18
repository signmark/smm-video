const axios = require('axios');

async function testStoriesWithMediaProduct() {
  console.log('🎬 ТЕСТ: Instagram Stories с media_product параметром');
  
  const payload = {
    contentId: `stories_media_product_${Date.now()}`,
    contentType: 'video_story',
    platforms: ['instagram'],
    scheduledAt: new Date().toISOString(),
    
    // Правильная конфигурация для Stories
    instagram_config: {
      media_type: 'VIDEO', // Правильно: VIDEO вместо STORIES
      published: true,
      story_media: true,
      api_version: 'v18.0',
      
      body_parameters: {
        video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
        media_type: 'VIDEO',
        published: true,
        media_product: 'STORY' // КЛЮЧЕВОЙ ПАРАМЕТР для Stories
      },
      
      stories_endpoint: true,
      direct_stories_publish: true
    },
    
    content: {
      title: 'Stories с media_product',
      description: 'Тест с правильным media_product параметром',
      videoUrl: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    
    metadata: {
      converted: true,
      videoFormat: 'mp4',
      resolution: '1080x1920',
      codec: 'H.264',
      media_product: 'STORY' // Дублируем в metadata для N8N
    },
    
    // Основные параметры для N8N
    media_type: 'VIDEO',
    media_product: 'STORY', // Главный параметр для Stories
    video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
    publish_mode: 'instagram_stories'
  };
  
  console.log('📋 PAYLOAD с media_product:');
  console.log(JSON.stringify(payload, null, 2));
  
  try {
    console.log('\n🚀 Отправляем запрос с media_product...');
    
    const response = await axios.post('https://n8n.nplanner.ru/webhook/publish-stories', payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('\n✅ N8N webhook принял запрос!');
    console.log('Status:', response.status);
    console.log('Response:', response.data || '""');
    
    console.log('\n🔍 ВАЖНО: Проверьте N8N execution logs');
    console.log('Если контейнер создался, но публикация падает:');
    console.log('1. В Create Container должен быть "media_product": "STORY"');
    console.log('2. В Publish должен быть "media_product": "STORY" + "creation_id"');
    
  } catch (error) {
    console.log('\n❌ ОШИБКА В ТЕСТЕ:');
    console.log('Status:', error.response?.status || 'No status');
    console.log('Error details:', error.response?.data || error.message);
    
    console.log('\n🔧 Возможные причины:');
    console.log('1. N8N workflow не обновлен для media_product параметра');
    console.log('2. Instagram API все еще не принимает наши параметры');
    console.log('3. Токены доступа истекли или неправильные');
    console.log('4. Нужно использовать другой endpoint для Stories');
  }
}

testStoriesWithMediaProduct();