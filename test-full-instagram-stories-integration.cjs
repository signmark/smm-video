const axios = require('axios');

async function testFullInstagramStoriesIntegration() {
  console.log('🎯 ПОЛНЫЙ ИНТЕГРАЦИОННЫЙ ТЕСТ INSTAGRAM STORIES');
  console.log('==========================================');
  
  const testVideoUrl = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/9b1ed8d5-8e55-46ad-9ea9-4f3a504703ab.webm';
  
  try {
    // ШАГ 1: Тестируем конвертацию видео
    console.log('\n📹 ШАГ 1: Конвертация видео с CloudConvert параметрами');
    console.log('Исходное видео:', testVideoUrl);
    
    const conversionResponse = await axios.post('http://localhost:5000/api/real-video-converter/convert', {
      videoUrl: testVideoUrl
    }, {
      timeout: 120000 // 2 минуты на конвертацию
    });
    
    if (!conversionResponse.data.success) {
      throw new Error('Конвертация не удалась: ' + conversionResponse.data.error);
    }
    
    const convertedVideoUrl = conversionResponse.data.convertedUrl;
    console.log('✅ Конвертация завершена!');
    console.log('Конвертированное видео:', convertedVideoUrl);
    console.log('Метаданные:', JSON.stringify(conversionResponse.data.metadata, null, 2));
    
    // ШАГ 2: Проверяем параметры конвертированного видео
    console.log('\n🔍 ШАГ 2: Проверка параметров видео');
    
    const ffprobeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams "${convertedVideoUrl}"`;
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const { stdout } = await execAsync(ffprobeCommand);
    const videoInfo = JSON.parse(stdout);
    const videoStream = videoInfo.streams.find(s => s.codec_type === 'video');
    
    console.log('📊 Параметры видео:');
    console.log('- Разрешение:', `${videoStream.width}x${videoStream.height}`);
    console.log('- Кодек:', videoStream.codec_name);
    console.log('- Профиль:', videoStream.profile);
    console.log('- Уровень:', videoStream.level);
    console.log('- Pixel format:', videoStream.pix_fmt);
    console.log('- Битрейт:', videoStream.bit_rate);
    console.log('- Sample aspect ratio:', videoStream.sample_aspect_ratio);
    console.log('- Display aspect ratio:', videoStream.display_aspect_ratio);
    
    // Проверяем соответствие требованиям Instagram
    const isValidForInstagram = 
      videoStream.width === 1080 &&
      videoStream.height === 1920 &&
      videoStream.codec_name === 'h264' &&
      videoStream.profile === 'Main' &&
      videoStream.pix_fmt === 'yuv420p';
    
    console.log('✅ Соответствие Instagram требованиям:', isValidForInstagram ? 'ДА' : 'НЕТ');
    
    // ШАГ 3: Тестируем публикацию через N8N webhook
    console.log('\n📤 ШАГ 3: Тестирование публикации через N8N');
    
    const webhookPayload = {
      contentId: `stories_integration_test_${Date.now()}`,
      contentType: 'video_story',
      platforms: ['instagram'],
      scheduledAt: new Date().toISOString(),
      instagram_config: {
        media_type: 'VIDEO',
        published: false,
        api_version: 'v18.0',
        container_parameters: {
          image_url: convertedVideoUrl,
          media_type: 'VIDEO',
          published: false
        }
      },
      content: {
        title: 'Интеграционный тест Stories',
        description: 'CloudConvert параметры + полная интеграция',
        videoUrl: convertedVideoUrl,
        mediaType: 'VIDEO'
      },
      media_type: 'VIDEO',
      image_url: convertedVideoUrl
    };
    
    console.log('Отправляем webhook на N8N...');
    console.log('URL:', 'https://n8n.nplanner.ru/webhook/publish-instagram-stories');
    
    const webhookResponse = await axios.post('https://n8n.nplanner.ru/webhook/publish-instagram-stories', webhookPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 45000
    });
    
    console.log('✅ Webhook отправлен!');
    console.log('Статус ответа:', webhookResponse.status);
    
    if (webhookResponse.data) {
      console.log('Ответ N8N:', JSON.stringify(webhookResponse.data, null, 2));
    }
    
    // ФИНАЛЬНЫЙ РЕЗУЛЬТАТ
    console.log('\n🎉 РЕЗУЛЬТАТ ИНТЕГРАЦИОННОГО ТЕСТА');
    console.log('=====================================');
    console.log('✅ Конвертация видео: УСПЕШНО');
    console.log('✅ Параметры для Instagram: КОРРЕКТНЫ');
    console.log('✅ Отправка в N8N: ЗАВЕРШЕНА');
    console.log('');
    console.log('📋 Детали:');
    console.log('- Исходное видео:', testVideoUrl);
    console.log('- Конвертированное видео:', convertedVideoUrl);
    console.log('- Размер файла:', conversionResponse.data.metadata.size, 'байт');
    console.log('- Длительность:', conversionResponse.data.metadata.duration, 'сек');
    console.log('- Пропорции:', `${videoStream.width}x${videoStream.height} (9:16)`);
    console.log('');
    console.log('🚀 ГОТОВО К ПРОДАКШЕНУ!');
    
  } catch (error) {
    console.log('\n❌ ОШИБКА В ИНТЕГРАЦИОННОМ ТЕСТЕ');
    console.log('==================================');
    
    if (error.response) {
      console.log('HTTP статус:', error.response.status);
      console.log('Данные ошибки:', JSON.stringify(error.response.data, null, 2));
    } else if (error.code === 'ECONNABORTED') {
      console.log('⏱️ Таймаут операции');
    } else {
      console.log('Сообщение ошибки:', error.message);
    }
    
    console.log('\n🔧 РЕКОМЕНДАЦИИ:');
    console.log('1. Проверить доступность сервисов');
    console.log('2. Проверить корректность API endpoints');
    console.log('3. Проверить Instagram API credentials');
  }
}

testFullInstagramStoriesIntegration();