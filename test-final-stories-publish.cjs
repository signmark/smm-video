/**
 * Финальный тест публикации Stories с исправленной конфигурацией
 */
const axios = require('axios');

async function testFinalStoriesPublish() {
  const SERVER_URL = 'http://localhost:5000';
  
  console.log('🎬 ФИНАЛЬНЫЙ ТЕСТ: Stories публикация с Instagram creation_id fix');
  
  // Создаем тестовый видео контент
  const storyData = {
    campaign_id: '8e4a1018-72ff-48eb-a3ff-9bd41bf83253', // Реальный campaign ID
    content_type: 'video',
    title: 'Финальный тест Stories',
    content: '<p>Тест исправленной публикации Instagram Stories</p>',
    video_url: 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755538595646_86mmakylf.mp4',
    status: 'draft'
  };
  
  console.log('Шаг 1: Создаем Stories контент...');
  
  try {
    // Создаем Stories
    const createResponse = await axios.post(`${SERVER_URL}/api/campaign-content`, storyData, {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsImVtYWlsIjoibGJyc3BiQGdtYWlsLmNvbSIsImlhdCI6MTc1NTUzNzM5MiwiZXhwIjoxNzU1NjIzNzkyfQ.Ww8QNmBb4H5wCPqoKgIXHw9lbNJMUfJKKLVfRb18bbY',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Stories контент создан:', createResponse.data.data.id);
    
    console.log('\nШаг 2: Публикуем с исправленным workflow...');
    
    // Публикуем через исправленный endpoint
    const publishResponse = await axios.post(`${SERVER_URL}/api/stories/publish-video/${createResponse.data.data.id}`, {}, {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsImVtYWlsIjoibGJyc3BiQGdtYWlsLmNvbSIsImlhdCI6MTc1NTUzNzM5MiwiZXhwIjoxNzU1NjIzNzkyfQ.Ww8QNmBb4H5wCPqoKgIXHw9lbNJMUfJKKLVfRb18bbY',
        'Content-Type': 'application/json'
      },
      timeout: 300000 // 5 минут на весь процесс
    });
    
    console.log('\n🎉 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ:');
    console.log('Status:', publishResponse.status);
    console.log('Success:', publishResponse.data.success);
    console.log('Message:', publishResponse.data.message);
    
    if (publishResponse.data.success) {
      console.log('\n✅ ПОЛНАЯ ПОБЕДА!');
      console.log('Story ID:', publishResponse.data.data.storyId);
      console.log('Исходное видео:', publishResponse.data.data.originalUrl);
      console.log('Конвертированное видео:', publishResponse.data.data.convertedUrl);
      console.log('Время конвертации:', publishResponse.data.data.conversionTime, 'мс');
      console.log('Webhook статус:', publishResponse.data.data.webhookStatus);
      
      if (publishResponse.data.data.metadata) {
        console.log('Metadata:', JSON.stringify(publishResponse.data.data.metadata, null, 2));
      }
    } else if (publishResponse.data.warning) {
      console.log('\n⚠️ Частичный успех:');
      console.log('Warning:', publishResponse.data.warning);
      console.log('Конвертированное видео:', publishResponse.data.data.convertedUrl);
      console.log('Error:', publishResponse.data.error);
    }
    
  } catch (error) {
    console.error('\n❌ ОШИБКА В ФИНАЛЬНОМ ТЕСТЕ:');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Network Error:', error.message);
    }
    
    console.log('\n🔧 Возможные причины:');
    console.log('1. N8N workflow все еще не настроен для Instagram Stories creation_id');
    console.log('2. Instagram токены доступа истекли или неправильные');
    console.log('3. Instagram API изменил требования к Stories');
    console.log('4. Нужно обновить N8N workflow для двухэтапного процесса');
  }
}

testFinalStoriesPublish();