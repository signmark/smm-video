/**
 * Тест решения проблемы Instagram Stories creation_id
 */
const axios = require('axios');

async function testInstagramStoriesCreationIdFix() {
  const N8N_WEBHOOK = 'https://n8n.roboflow.space/webhook/publish-stories';
  const VIDEO_URL = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4';
  
  console.log('🔧 Тестируем решение проблемы creation_id для Instagram Stories');
  
  // Попытка 1: Указать что нужен двухэтапный процесс
  const payload1 = {
    contentId: 'test_story_' + Date.now(),
    contentType: 'video_story',
    platforms: ['instagram'],
    
    // Instagram API specific config
    instagram_config: {
      two_step_process: true, // Указываем что нужен двухэтапный процесс
      create_container_first: true,
      media_type: 'VIDEO',
      published: false // Сначала создать контейнер, не публиковать
    },
    
    content: {
      title: 'Test Instagram Stories with creation_id fix',
      videoUrl: VIDEO_URL,
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    
    // Дополнительные поля для N8N
    video_url: VIDEO_URL,
    media_type: 'VIDEO',
    publish_mode: 'instagram_stories'
  };
  
  console.log('Попытка 1: Двухэтапный процесс');
  await testPayload(N8N_WEBHOOK, payload1, 'Two-step process');
  
  // Попытка 2: Прямая публикация с published=true
  const payload2 = {
    contentId: 'test_story_direct_' + Date.now(),
    contentType: 'video_story',
    platforms: ['instagram'],
    
    // Прямая публикация
    instagram_config: {
      media_type: 'VIDEO',
      published: true, // Публиковать сразу
      direct_publish: true
    },
    
    content: {
      title: 'Test Instagram Stories direct publish',
      videoUrl: VIDEO_URL,
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    
    video_url: VIDEO_URL,
    media_type: 'VIDEO',
    publish_mode: 'instagram_stories'
  };
  
  console.log('\nПопытка 2: Прямая публикация');
  await testPayload(N8N_WEBHOOK, payload2, 'Direct publish');
  
  // Попытка 3: Fallback на обычный пост если Stories не работают
  const payload3 = {
    contentId: 'test_fallback_' + Date.now(),
    contentType: 'video',
    platforms: ['instagram'],
    
    instagram_config: {
      media_type: 'VIDEO',
      fallback_to_feed: true, // Fallback на обычный пост в ленту
      message: 'Это было Stories, но публикуем как обычный пост'
    },
    
    content: {
      title: 'Instagram fallback video post',
      videoUrl: VIDEO_URL,
      description: 'Stories fallback to feed post'
    },
    
    video_url: VIDEO_URL,
    media_type: 'VIDEO'
  };
  
  console.log('\nПопытка 3: Fallback на обычный пост');
  await testPayload(N8N_WEBHOOK, payload3, 'Fallback to feed');
}

async function testPayload(url, payload, testName) {
  try {
    console.log(`Тестируем: ${testName}`);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    const response = await axios.post(url, payload, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ ${testName} - УСПЕХ!`);
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error(`❌ ${testName} - ОШИБКА`);
    
    if (error.response?.data) {
      console.error('Status:', error.response.status);
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
      
      // Парсим ошибки Instagram API
      if (error.response.data.error?.message) {
        try {
          const instagramError = JSON.parse(error.response.data.error.message.replace(/^\d+\s*-\s*/, ''));
          console.error('Instagram API Error:', instagramError);
          
          if (instagramError.error?.message) {
            console.error('🔍 Instagram сообщение:', instagramError.error.message);
          }
        } catch (parseError) {
          console.error('Raw error message:', error.response.data.error.message);
        }
      }
    } else {
      console.error('Network Error:', error.message);
    }
  }
}

testInstagramStoriesCreationIdFix();