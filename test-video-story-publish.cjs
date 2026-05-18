/**
 * Тест публикации видео Stories с реальной конвертацией
 */
const axios = require('axios');

async function testVideoStoryPublish() {
  const SERVER_URL = 'http://localhost:5000';
  
  // Тестовый токен - замените на реальный токен пользователя
  const AUTH_TOKEN = 'Bearer your_test_token_here';
  
  // ID Stories с видео для публикации - замените на реальный ID
  const STORY_ID = 'test_story_id';
  
  try {
    console.log('🎬 Тестируем публикацию видео Stories с FFmpeg конвертацией');
    console.log('Story ID:', STORY_ID);
    
    const response = await axios.post(`${SERVER_URL}/api/stories/publish-video/${STORY_ID}`, {}, {
      headers: {
        'Authorization': AUTH_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 300000 // 5 минут на конвертацию и публикацию
    });
    
    console.log('\n✅ Публикация завершена!');
    console.log('Статус:', response.status);
    console.log('Результат:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log('\n🎉 УСПЕХ! Видео Stories опубликована:');
      console.log('Story ID:', response.data.data.storyId);
      console.log('Исходное видео:', response.data.data.originalUrl);
      console.log('Конвертированное видео:', response.data.data.convertedUrl);
      console.log('Время конвертации:', response.data.data.conversionTime, 'мс');
      
      if (response.data.data.webhookStatus) {
        console.log('Webhook статус:', response.data.data.webhookStatus);
      }
    } else if (response.data.warning) {
      console.log('\n⚠️ Конвертация успешна, но есть предупреждение:');
      console.log('Предупреждение:', response.data.warning);
      console.log('Конвертированное видео:', response.data.data.convertedUrl);
    }
    
  } catch (error) {
    if (error.response) {
      console.error('❌ Ошибка API:', error.response.status);
      console.error('Детали:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('❌ Ошибка сети:', error.message);
    }
    
    console.log('\n💡 Инструкция для тестирования:');
    console.log('1. Создайте Stories с видео через UI');
    console.log('2. Скопируйте ID Stories из браузера');
    console.log('3. Получите токен авторизации из browser DevTools');
    console.log('4. Обновите переменные STORY_ID и AUTH_TOKEN в этом файле');
    console.log('5. Запустите тест повторно: node test-video-story-publish.cjs');
  }
}

console.log('📝 ПРИМЕЧАНИЕ: Это тест требует реальных данных');
console.log('Обновите STORY_ID и AUTH_TOKEN в файле для тестирования');
console.log('');

testVideoStoryPublish();