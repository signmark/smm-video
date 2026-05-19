/**
 * Тест реального видео конвертера с FFmpeg
 */

const axios = require('axios');

const SERVER_URL = 'http://localhost:5000';
const STORY_ID = '6d8bf3c7-7706-4e5c-bfc1-218172beb864';

async function testRealVideoConverter() {
  console.log('🎬 Тестируем НАСТОЯЩИЙ видео конвертер с FFmpeg');
  
  try {
    // Шаг 1: Проверяем доступность FFmpeg
    console.log('\n1️⃣ Проверка FFmpeg...');
    const statusResponse = await axios.get(`${SERVER_URL}/api/real-video-converter/status`);
    console.log('Статус FFmpeg:', statusResponse.data);
    
    if (!statusResponse.data.ffmpegAvailable) {
      console.error('❌ FFmpeg недоступен, остановка теста');
      return;
    }
    
    // Шаг 2: Получаем Story с видео
    console.log('\n2️⃣ Получаем Story для конвертации...');
    const storyResponse = await axios.get(`https://directus.roboflow.space/items/campaign_content/${STORY_ID}`, {
      headers: {
        'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
      }
    });
    
    const story = storyResponse.data.data;
    console.log('Story найдена:', {
      id: story.id,
      title: story.title,
      hasVideo: !!story.video_url,
      originalVideoUrl: story.video_url
    });
    
    if (!story.video_url) {
      console.error('❌ У Story нет видео для конвертации');
      return;
    }
    
    // Шаг 3: Запускаем реальную конвертацию
    console.log('\n3️⃣ Запуск FFmpeg конвертации (это займет время)...');
    console.log('⏳ Конвертация видео для Instagram Stories...');
    
    const conversionStart = Date.now();
    const conversionResponse = await axios.post(`${SERVER_URL}/api/real-video-converter/convert-content`, {
      contentId: STORY_ID
    }, {
      timeout: 600000 // 10 минут
    });
    
    const conversionTime = Date.now() - conversionStart;
    
    console.log('\n✅ Конвертация завершена!');
    console.log(`⏱️  Время конвертации: ${Math.round(conversionTime / 1000)} секунд`);
    console.log('Результат:', JSON.stringify(conversionResponse.data, null, 2));
    
    // Шаг 4: Проверяем обновленную Story
    console.log('\n4️⃣ Проверяем обновленную Story в базе...');
    const updatedStoryResponse = await axios.get(`https://directus.roboflow.space/items/campaign_content/${STORY_ID}`, {
      headers: {
        'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
      }
    });
    
    const updatedStory = updatedStoryResponse.data.data;
    
    // Шаг 5: Анализируем результат
    console.log('\n📊 АНАЛИЗ РЕЗУЛЬТАТА:');
    console.log('='.repeat(50));
    
    const originalUrl = story.video_url;
    const newUrl = updatedStory.video_url;
    
    if (originalUrl !== newUrl) {
      console.log('✅ URL видео РЕАЛЬНО изменился!');
      console.log('📥 Исходный:', originalUrl.substring(0, 80) + '...');
      console.log('📤 Новый:', newUrl.substring(0, 80) + '...');
      
      // Проверяем признаки реальной конвертации
      if (newUrl.includes('_converted') || newUrl.includes('ig_stories_converted')) {
        console.log('✅ Видео имеет метку конвертации');
      }
      
      if (newUrl.includes('.mp4')) {
        console.log('✅ Новое видео в формате MP4');
      }
      
      if (conversionResponse.data.metadata) {
        console.log('✅ Метаданные конвертации:');
        console.log('   Разрешение:', `${conversionResponse.data.metadata.width}x${conversionResponse.data.metadata.height}`);
        console.log('   Длительность:', `${conversionResponse.data.metadata.duration} сек`);
        console.log('   Размер:', `${Math.round(conversionResponse.data.metadata.size / 1024 / 1024)} MB`);
      }
      
      console.log('\n🎉 УСПЕХ! Реальная конвертация работает!');
      
    } else {
      console.log('❌ URL не изменился - возможно, конвертация не сработала');
      console.log('Или видео уже было сконвертировано ранее');
    }
    
  } catch (error) {
    console.error('\n💥 ОШИБКА:', error.message);
    if (error.response?.data) {
      console.error('Детали:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Запускаем тест
testRealVideoConverter();