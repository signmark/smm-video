/**
 * Тест правильной конфигурации Instagram Stories API
 */
const axios = require('axios');

async function testCorrectInstagramStoriesAPI() {
  const N8N_WEBHOOK = 'https://n8n.roboflow.space/webhook/publish-stories';
  const VIDEO_URL = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4';
  
  console.log('🎯 ТЕСТ ПРАВИЛЬНОЙ Instagram Stories API конфигурации');
  
  // Правильная конфигурация согласно Instagram Stories API
  const correctPayload = {
    contentId: 'stories_fix_' + Date.now(),
    contentType: 'video_story',
    platforms: ['instagram'],
    scheduledAt: new Date().toISOString(),
    
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ для Instagram Stories API
    instagram_config: {
      media_type: 'STORIES', // ВАЖНО: STORIES вместо VIDEO
      published: true, // Прямая публикация для Stories
      direct_publish: true,
      stories_mode: true,
      api_version: 'v18.0',
      fallback_to_two_step: true,
      fallback_publish_endpoint: 'creation_id_direct'
    },
    
    content: {
      title: 'Правильный Instagram Stories тест',
      description: 'Тест с правильными параметрами API',
      videoUrl: VIDEO_URL,
      mediaType: 'VIDEO',
      storyType: 'instagram_stories'
    },
    
    metadata: {
      converted: true,
      videoFormat: 'mp4',
      resolution: '1080x1920',
      codec: 'H.264'
    },
    
    // Дублируем важные поля на верхнем уровне для совместимости
    media_type: 'STORIES', // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ
    video_url: VIDEO_URL,
    publish_mode: 'instagram_stories'
  };
  
  console.log('📋 PAYLOAD с правильной конфигурацией:');
  console.log(JSON.stringify(correctPayload, null, 2));
  
  try {
    console.log('\n🚀 Отправляем запрос с исправленной конфигурацией...');
    
    const response = await axios.post(N8N_WEBHOOK, correctPayload, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('\n✅ N8N webhook принял запрос!');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    console.log('\n🔍 ВАЖНО: Проверьте N8N execution logs');
    console.log('Если все равно ошибка creation_id, то N8N workflow нужно обновить:');
    console.log('1. Изменить media_type на "STORIES" в Create Container');
    console.log('2. Изменить Publish URL с /media_publish на /{creation-id}');
    console.log('3. Добавить published: true в Publish body');
    
  } catch (error) {
    console.error('\n❌ Ошибка при отправке в N8N:');
    
    if (error.response?.data) {
      console.error('Status:', error.response.status);
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
      
      // Анализ ошибки Instagram API
      if (error.response.data.error?.message) {
        const errorMsg = error.response.data.error.message;
        console.error('\n🔍 Анализ ошибки Instagram API:');
        console.error('Raw message:', errorMsg);
        
        if (errorMsg.includes('creation_id')) {
          console.log('\n💡 РЕШЕНИЕ: N8N workflow все еще использует неправильный endpoint');
          console.log('Нужно изменить в N8N:');
          console.log('- Publish Story URL: /{creation-id} вместо /{account-id}/media_publish');
          console.log('- Publish Story body: {"published": true} вместо {"creation_id": "..."}');
        }
        
        if (errorMsg.includes('media_type')) {
          console.log('\n💡 РЕШЕНИЕ: Нужно изменить media_type на "STORIES"');
        }
      }
    } else {
      console.error('Network Error:', error.message);
    }
  }
}

testCorrectInstagramStoriesAPI();