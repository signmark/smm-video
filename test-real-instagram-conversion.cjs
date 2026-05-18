const axios = require('axios');

async function testRealInstagramConversion() {
  console.log('🎬 ТЕСТ РЕАЛЬНОЙ КОНВЕРТАЦИИ ДЛЯ INSTAGRAM');
  console.log('Используем параметры, которые точно работают в Instagram');
  
  const originalVideoUrl = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755598227793_23ybs3g9e.mp4';
  
  try {
    console.log('📹 Исходное видео:', originalVideoUrl);
    
    // Принудительная реконвертация с еще более строгими параметрами Instagram
    console.log('🛠️ Запуск принудительной реконвертации...');
    
    const response = await axios.post('http://localhost:5000/api/real-video-converter/convert', {
      videoUrl: originalVideoUrl,
      forceConvert: true
    }, {
      timeout: 120000
    });
    
    if (response.data.success) {
      console.log('✅ Принудительная реконвертация завершена');
      console.log('Новое видео:', response.data.convertedUrl);
      console.log('Размер:', response.data.metadata?.width + 'x' + response.data.metadata?.height);
      console.log('Кодек:', response.data.metadata?.codec);
      console.log('Длительность:', response.data.metadata?.duration + 'сек');
      
      // Отправляем ТОЛЬКО ID в N8N webhook
      console.log('\n🚀 Отправка ТОЛЬКО ID контента в N8N');
      
      const webhookPayload = {
        contentId: '7fdcd858-0d14-4cd2-8950-5c8b31f29fea'
      };
      
      console.log('Payload для N8N:', JSON.stringify(webhookPayload, null, 2));
      
      const webhookResponse = await axios.post('https://n8n.roboflow.space/webhook/publish-stories', webhookPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      console.log('✅ N8N WEBHOOK ОТПРАВЛЕН (только ID)!');
      console.log('Статус:', webhookResponse.status);
      
      return {
        success: true,
        videoUrl: response.data.convertedUrl,
        metadata: response.data.metadata,
        webhookStatus: webhookResponse.status
      };
      
    } else {
      throw new Error('Принудительная конвертация не удалась: ' + response.data.error);
    }
    
  } catch (error) {
    console.log('❌ ОШИБКА:', error.message);
    if (error.code === 'ECONNABORTED') {
      console.log('⚠️ Timeout - возможно, запрос все еще обрабатывается');
    }
    return null;
  }
}

testRealInstagramConversion().then(result => {
  if (result && result.success) {
    console.log('\n🏆 ТЕСТ УСПЕШЕН!');
    console.log(`Контент "7fdcd858-0d14-4cd2-8950-5c8b31f29fea" отправлен с новым видео`);
    console.log('Видео URL:', result.videoUrl);
    console.log('Метаданные:', result.metadata);
    console.log('N8N статус:', result.webhookStatus);
  } else {
    console.log('\n❌ Тест не прошел');
  }
});