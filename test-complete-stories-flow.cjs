/**
 * Полный тест Stories workflow: конвертация + публикация
 */
const axios = require('axios');

async function testCompleteStoriesFlow() {
  const SERVER_URL = 'http://localhost:5000';
  
  console.log('🎬 Тестируем полный Stories workflow');
  
  // Шаг 1: Конвертируем тестовое видео
  console.log('\n1️⃣ Конвертируем тестовое видео...');
  
  const testVideoUrl = 'https://sample-videos.com/zip/10/webm/SampleVideo_360x240_1mb.webm';
  
  try {
    const conversionResponse = await axios.post(`${SERVER_URL}/api/real-video-converter/convert`, {
      videoUrl: testVideoUrl
    }, {
      timeout: 300000
    });
    
    console.log('✅ Конвертация успешна:', conversionResponse.data.convertedUrl);
    
    // Шаг 2: Создаем Stories контент
    console.log('\n2️⃣ Создаем Stories контент...');
    
    const storyData = {
      campaign_id: 'test_campaign',
      content_type: 'video',
      title: 'Test Video Story',
      content: '<p>Тестовая Stories</p>',
      video_url: conversionResponse.data.convertedUrl,
      status: 'draft'
    };
    
    // Для тестирования используем системный токен (в реальности нужен пользовательский)
    const AUTH_TOKEN = `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN || 'test_token'}`;
    
    const createResponse = await axios.post(`${SERVER_URL}/api/campaign-content`, storyData, {
      headers: {
        'Authorization': AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Stories контент создан:', createResponse.data.data.id);
    
    // Шаг 3: Публикуем через N8N
    console.log('\n3️⃣ Публикуем через N8N Stories webhook...');
    
    const n8nPayload = {
      contentId: createResponse.data.data.id,
      contentType: 'video_story',
      platforms: ['instagram'],
      scheduledAt: new Date().toISOString(),
      content: {
        title: storyData.title,
        description: storyData.content,
        videoUrl: conversionResponse.data.convertedUrl,
        mediaType: 'VIDEO',
        storyType: 'instagram_stories'
      },
      metadata: {
        converted: true,
        videoFormat: 'mp4',
        resolution: '1080x1920',
        codec: 'H.264'
      },
      media_type: 'VIDEO',
      video_url: conversionResponse.data.convertedUrl,
      publish_mode: 'instagram_stories'
    };
    
    const webhookResponse = await axios.post('https://n8n.roboflow.space/webhook/publish-stories', n8nPayload, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ N8N публикация успешна, статус:', webhookResponse.status);
    
    console.log('\n🎉 ПОЛНЫЙ WORKFLOW ЗАВЕРШЕН УСПЕШНО!');
    console.log('Story ID:', createResponse.data.data.id);
    console.log('Конвертированное видео:', conversionResponse.data.convertedUrl);
    console.log('N8N статус:', webhookResponse.status);
    
  } catch (error) {
    console.error('\n❌ Ошибка в workflow:');
    
    if (error.response) {
      console.error('Статус:', error.response.status);
      console.error('Ошибка:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Сетевая ошибка:', error.message);
    }
  }
}

testCompleteStoriesFlow();