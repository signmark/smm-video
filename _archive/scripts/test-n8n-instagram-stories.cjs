/**
 * Тест N8N Instagram Stories webhook
 */
const axios = require('axios');

async function testN8NInstagramStories() {
  const N8N_WEBHOOK = 'https://n8n.roboflow.space/webhook/publish-stories';
  
  // Тестовый payload с конвертированным видео
  const testPayload = {
    contentId: 'test_story_id',
    contentType: 'video_story',
    platforms: ['instagram'],
    scheduledAt: new Date().toISOString(),
    content: {
      title: 'Test Video Story',
      description: 'Тестовая Stories с конвертированным видео',
      videoUrl: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    metadata: {
      converted: true,
      conversionTime: 5000,
      videoFormat: 'mp4',
      resolution: '1080x1920',
      codec: 'H.264',
      width: 1080,
      height: 1920,
      duration: '30s'
    },
    campaignId: 'test_campaign_id',
    userId: 'test_user_id',
    // Instagram API specific fields
    media_type: 'VIDEO',
    video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
    publish_mode: 'instagram_stories'
  };
  
  console.log('🔧 Тестируем N8N Instagram Stories webhook');
  console.log('Webhook URL:', N8N_WEBHOOK);
  console.log('Payload:', JSON.stringify(testPayload, null, 2));
  
  try {
    const response = await axios.post(N8N_WEBHOOK, testPayload, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('\n✅ N8N webhook successful!');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('\n❌ N8N webhook failed');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.data && error.response.data.error) {
        console.error('\nПодробная ошибка:', error.response.data.error);
        
        // Парсим ошибку Instagram API
        if (typeof error.response.data.error.message === 'string') {
          try {
            const instagramError = JSON.parse(error.response.data.error.message.replace('400 - ', ''));
            console.error('Instagram API Error:', JSON.stringify(instagramError, null, 2));
            
            if (instagramError.error && instagramError.error.message) {
              console.error('\n🔍 Instagram говорит:', instagramError.error.message);
              
              if (instagramError.error.message.includes('creation_id')) {
                console.log('\n💡 РЕШЕНИЕ: N8N workflow должен создать creation_id перед публикацией');
                console.log('1. Сначала вызвать POST /{page-id}/media для создания контейнера');
                console.log('2. Затем вызвать POST /{creation-id}/publish для публикации');
              }
            }
          } catch (parseError) {
            console.error('Не удалось распарсить ошибку Instagram API');
          }
        }
      }
    } else {
      console.error('Network Error:', error.message);
    }
    
    console.log('\n🔧 Возможные причины:');
    console.log('1. N8N workflow не настроен правильно для Instagram Stories');
    console.log('2. Отсутствуют токены доступа Instagram');
    console.log('3. Неправильный формат payload для Instagram API');
    console.log('4. N8N workflow не создает creation_id для контейнера');
  }
}

testN8NInstagramStories();