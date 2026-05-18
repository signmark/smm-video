/**
 * ЭКСТРЕННАЯ ОСТАНОВКА YOUTUBE ПУБЛИКАЦИЙ - КРИТИЧЕСКАЯ СИТУАЦИЯ
 * Обнаружено дублирование публикаций YouTube видео
 */

import axios from 'axios';

async function emergencyStopYouTubePublishing() {
  console.log('🚨 ЭКСТРЕННАЯ ОСТАНОВКА YOUTUBE ПУБЛИКАЦИЙ');
  
  const directusUrl = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
  const token = process.env.DIRECTUS_TOKEN;
  
  if (!token) {
    console.error('❌ DIRECTUS_TOKEN не найден');
    return;
  }
  
  try {
    // 1. Получаем все YouTube контент со статусом pending/scheduled
    console.log('📋 Получаем YouTube контент со статусом pending/scheduled...');
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter[content_type][_eq]': 'video',
        'filter[social_platforms][_contains]': 'youtube',
        limit: -1
      }
    });
    
    const youtubeContent = contentResponse.data.data.filter(item => {
      if (!item.social_platforms || !item.social_platforms.youtube) return false;
      const status = item.social_platforms.youtube.status;
      return status === 'pending' || status === 'scheduled';
    });
    
    console.log(`📊 Найдено ${youtubeContent.length} YouTube контента для блокировки`);
    
    // 2. Блокируем все pending/scheduled YouTube контент
    for (const content of youtubeContent) {
      console.log(`🔒 Блокируем YouTube публикацию для контента ${content.id}`);
      
      const updateData = {
        social_platforms: {
          ...content.social_platforms,
          youtube: {
            ...content.social_platforms.youtube,
            status: 'emergency_blocked',
            error: 'Публикации заблокированы из-за обнаружения дублирования',
            blockedAt: new Date().toISOString()
          }
        }
      };
      
      await axios.patch(`${directusUrl}/items/campaign_content/${content.id}`, updateData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log(`✅ Контент ${content.id} заблокирован`);
    }
    
    console.log('🛡️ ВСЕ YOUTUBE ПУБЛИКАЦИИ ЭКСТРЕННО ЗАБЛОКИРОВАНЫ');
    console.log('⚠️ ТРЕБУЕТСЯ ИСПРАВЛЕНИЕ ЛОГИКИ ДУБЛИРОВАНИЯ ПЕРЕД ВОЗОБНОВЛЕНИЕМ');
    
  } catch (error) {
    console.error('❌ Ошибка экстренной остановки:', error.message);
  }
}

// Запускаем экстренную остановку
emergencyStopYouTubePublishing();