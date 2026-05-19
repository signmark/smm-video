const axios = require('axios');

async function updateContentVideoUrl() {
  console.log('🔄 ОБНОВЛЕНИЕ URL ВИДЕО В КОНТЕНТЕ');
  
  const contentId = '7fdcd858-0d14-4cd2-8950-5c8b31f29fea';
  const originalVideoUrl = 'https://6e679636ae90-ridiculous-seth.s3.ru1.storage.beget.cloud/videos/ig_stories_converted_1755600756405_05lqzi6v4.mp4';
  
  try {
    console.log('📹 Принудительная реконвертация с обновлением контента');
    console.log('Content ID:', contentId);
    console.log('Исходное видео:', originalVideoUrl);
    
    // Принудительная реконвертация с указанием contentId для автообновления
    const response = await axios.post('http://localhost:5000/api/real-video-converter/convert', {
      videoUrl: originalVideoUrl,
      forceConvert: true,
      contentId: contentId  // ПЕРЕДАЕМ ID КОНТЕНТА для автообновления
    }, {
      timeout: 120000
    });
    
    if (response.data.success) {
      console.log('✅ Реконвертация завершена');
      console.log('Новое видео:', response.data.convertedUrl);
      console.log('Контент обновлен:', response.data.contentUpdated);
      
      // Теперь отправляем только ID в N8N
      console.log('\n🚀 Отправка только ID контента в N8N');
      
      const webhookPayload = {
        contentId: contentId
      };
      
      const webhookResponse = await axios.post('https://n8n.roboflow.space/webhook/publish-stories', webhookPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });
      
      console.log('✅ N8N WEBHOOK ОТПРАВЛЕН!');
      console.log('Статус:', webhookResponse.status);
      
      return {
        success: true,
        newVideoUrl: response.data.convertedUrl,
        contentUpdated: response.data.contentUpdated,
        webhookStatus: webhookResponse.status
      };
      
    } else {
      throw new Error('Реконвертация не удалась: ' + response.data.error);
    }
    
  } catch (error) {
    console.log('❌ ОШИБКА:', error.message);
    if (error.code === 'ECONNABORTED') {
      console.log('⚠️ Timeout - но запрос обработан');
    }
    return null;
  }
}

updateContentVideoUrl().then(result => {
  if (result && result.success) {
    console.log('\n🏆 КОНТЕНТ ОБНОВЛЕН!');
    console.log(`✅ Content ID "${contentId}" теперь содержит новое видео`);
    console.log('Новый URL:', result.newVideoUrl);
    console.log('Контент обновлен в Directus:', result.contentUpdated);
    console.log('N8N статус:', result.webhookStatus);
  } else {
    console.log('\n❌ Обновление не удалось');
  }
});