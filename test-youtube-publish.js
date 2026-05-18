/**
 * Прямой тест YouTube публикации
 */

import fetch from 'node-fetch';

async function testYouTubePublish() {
  try {
    console.log('🎬 Тестируем YouTube публикацию...');
    
    // Получаем контент для публикации
    const contentResponse = await fetch('https://directus.roboflow.tech/items/campaign_content/bea24ff7-9c75-4404-812b-06d355bd98ac', {
      headers: {
        'Authorization': 'Bearer _cYEZbtGwG2biL0UnpdI6Q58EaW22VRm'
      }
    });
    
    const contentData = await contentResponse.json();
    const content = contentData.data;
    
    console.log('📹 Контент получен:', content.title);
    console.log('🔗 Видео URL:', content.video_url);
    
    // Получаем настройки кампании
    const campaignResponse = await fetch('https://directus.roboflow.tech/items/user_campaigns/46868c44-c6a4-4bed-accf-9ad07bba790e', {
      headers: {
        'Authorization': 'Bearer _cYEZbtGwG2biL0UnpdI6Q58EaW22VRm'
      }
    });
    
    const campaignData = await campaignResponse.json();
    const campaignSettings = campaignData.data.social_media_settings;
    
    console.log('⚙️ YouTube настройки получены');
    console.log('🔑 API Key:', campaignSettings.youtube.apiKey ? 'ЕСТЬ' : 'НЕТ');
    console.log('📺 Channel ID:', campaignSettings.youtube.channelId);
    console.log('🎫 Access Token:', campaignSettings.youtube.accessToken ? 'ЕСТЬ' : 'НЕТ');
    
    // Вызываем прямой YouTube роут с правильными параметрами
    const publishData = {
      content: content,
      campaignSettings: campaignSettings,
      userId: content.user_id,
      platforms: ['youtube']
    };
    
    console.log('🚀 Отправляем запрос на публикацию в YouTube...');
    
    const publishResponse = await fetch('http://localhost:5000/api/publish/direct-youtube', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(publishData)
    });
    
    const publishResult = await publishResponse.json();
    
    console.log('📊 Результат публикации:', publishResult);
    
    if (publishResult.success) {
      console.log('✅ YouTube публикация успешна!');
      console.log('🔗 URL видео:', publishResult.postUrl);
    } else {
      console.log('❌ Ошибка публикации:', publishResult.error);
    }
    
  } catch (error) {
    console.error('💥 Ошибка теста:', error.message);
  }
}

testYouTubePublish();