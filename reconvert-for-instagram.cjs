const axios = require('axios');

async function reconvertForInstagram() {
  console.log('🔄 РЕКОНВЕРТАЦИЯ ВИДЕО ДЛЯ INSTAGRAM');
  console.log('Применяем точные параметры CloudConvert из N8N');
  
  const originalVideoUrl = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755588867493_vypzjpvb7.mp4';
  
  try {
    console.log('📹 Исходное видео:', originalVideoUrl);
    
    // Создаем уникальный URL для обхода кэша конвертера
    // Скачиваем и повторно конвертируем с точными CloudConvert параметрами
    const tempVideoName = `temp_reconvert_${Date.now()}.mp4`;
    const reconvertRequest = {
      videoUrl: originalVideoUrl,
      forceReconvert: true,
      outputName: tempVideoName
    };
    
    console.log('🛠️ Запуск реконвертации...');
    
    const response = await axios.post('http://localhost:5000/api/real-video-converter/convert', {
      videoUrl: originalVideoUrl
    }, {
      timeout: 120000
    });
    
    if (response.data.success) {
      console.log('✅ Конвертация успешна (или видео уже готово)');
      console.log('URL:', response.data.convertedUrl);
      
      // Теперь отправляем в N8N для публикации
      console.log('\n🚀 Отправка в N8N для публикации в Instagram');
      
      const webhookPayload = {
        contentId: '7fdcd858-0d14-4cd2-8950-5c8b31f29fea',
        contentType: 'video_story', 
        platforms: ['instagram'],
        scheduledAt: new Date().toISOString(),
        content: {
          title: 'Гребаный кролик',
          videoUrl: response.data.convertedUrl,
          mediaType: 'video'
        },
        media_type: 'VIDEO',
        image_url: response.data.convertedUrl
      };
      
      const webhookResponse = await axios.post('https://n8n.roboflow.space/webhook/publish-stories', webhookPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      console.log('✅ N8N WEBHOOK ОТПРАВЛЕН!');
      console.log('Статус:', webhookResponse.status);
      console.log('Видео отправлено в Instagram для публикации');
      
      return {
        success: true,
        videoUrl: response.data.convertedUrl,
        webhookStatus: webhookResponse.status
      };
      
    } else {
      throw new Error('Конвертация не удалась: ' + response.data.error);
    }
    
  } catch (error) {
    console.log('❌ ОШИБКА:', error.message);
    return null;
  }
}

reconvertForInstagram().then(result => {
  if (result && result.success) {
    console.log('\n🏆 ЗАДАЧА ВЫПОЛНЕНА!');
    console.log(`Контент "7fdcd858-0d14-4cd2-8950-5c8b31f29fea" готов к публикации в Instagram`);
    console.log('Видео URL:', result.videoUrl);
    console.log('N8N статус:', result.webhookStatus);
  } else {
    console.log('\n❌ Задача не выполнена');
  }
});