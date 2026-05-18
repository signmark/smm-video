/**
 * Тест реального видео конвертера
 */
const axios = require('axios');

async function testVideoConverter() {
  const SERVER_URL = 'http://localhost:5000';
  const TEST_VIDEO_URL = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/9b1ed8d5-8e55-46ad-9ea9-4f3a504703ab.webm';
  
  try {
    console.log('🎬 Тестируем реальный видео конвертер FFmpeg');
    console.log('Исходное видео:', TEST_VIDEO_URL);
    
    const response = await axios.post(`${SERVER_URL}/api/real-video-converter/convert`, {
      videoUrl: TEST_VIDEO_URL
    }, {
      timeout: 300000 // 5 минут
    });
    
    console.log('\n✅ Конвертация завершена!');
    console.log('Результат:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success && response.data.convertedUrl) {
      console.log('\n🎉 УСПЕХ! Видео сконвертировано:');
      console.log('Исходный URL:', response.data.originalUrl);
      console.log('Конвертированный URL:', response.data.convertedUrl);
      
      // Проверяем, что новый URL действительно MP4
      if (response.data.convertedUrl.includes('.mp4')) {
        console.log('✅ Новое видео в формате MP4');
      }
    } else {
      console.log('❌ Конвертация не удалась');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

testVideoConverter();