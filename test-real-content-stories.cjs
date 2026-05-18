const axios = require('axios');

async function testRealContentStories() {
  console.log('🎬 ТЕСТИРУЕМ REAL CONTENT STORIES: 6851f165-9063-47a4-939c-4cdfe1a7e765');
  
  try {
    console.log('🔍 Получаем данные контента...');
    
    // Получаем токен из браузера (обновленный)
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsImVtYWlsIjoibGJyc3BiQGdtYWlsLmNvbSIsImlhdCI6MTczNzI2MzU5NywiZXhwIjoxNzM3MzQ5OTk3fQ.qHrUKcrRjnQK_KK5xXWBZLpYvmlXpzJGJAmwUYVqkB0';
    
    console.log('🚀 Запускаем публикацию Stories с исправленным видео конвертером...');
    
    const response = await axios.post('http://localhost:5000/api/stories/publish', {
      storyId: '6851f165-9063-47a4-939c-4cdfe1a7e765'
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 минуты для конвертации и публикации
    });
    
    console.log('✅ Stories публикация запущена!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    // Если есть URL конвертированного видео, проверим его параметры
    if (response.data.convertedUrl) {
      console.log(`\n🔍 Проверим параметры конвертированного видео: ${response.data.convertedUrl}`);
    }
    
  } catch (error) {
    console.log('❌ ОШИБКА:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('🔑 Проблема с авторизацией - токен устарел');
    } else if (error.response?.status === 404) {
      console.log('📄 Контент не найден');
    } else if (error.message.includes('timeout')) {
      console.log('⏱️ Таймаут - конвертация занимает слишком много времени');
    }
  }
}

testRealContentStories();