/**
 * Скрипт для ручного сброса quota_exceeded статусов YouTube
 * Находит весь контент с quota_exceeded статусом и сбрасывает его в pending
 */

import fetch from 'node-fetch';

async function resetYouTubeQuotas() {
  try {
    console.log('🔄 Начинаем сброс YouTube quota_exceeded статусов...');
    
    // Используем админский токен
    const adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    if (!adminToken) {
      throw new Error('Не найден админский токен в переменных окружения');
    }
    
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech/';
    const baseUrl = directusUrl.endsWith('/') ? directusUrl.slice(0, -1) : directusUrl;
    
    console.log(`📡 Подключаемся к Directus: ${baseUrl}`);
    
    // Получаем весь контент с quota_exceeded статусом для YouTube
    const response = await fetch(`${baseUrl}/items/campaign_content?limit=1000`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Ошибка получения контента: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const allContent = data.data || [];
    
    console.log(`📊 Найдено ${allContent.length} записей для анализа`);
    
    let resetCount = 0;
    
    for (const content of allContent) {
      let socialPlatforms = content.social_platforms;
      
      // Парсим JSON если нужно
      if (typeof socialPlatforms === 'string') {
        try {
          socialPlatforms = JSON.parse(socialPlatforms);
        } catch (e) {
          console.log(`⚠️ Ошибка парсинга JSON для контента ${content.id}`);
          continue;
        }
      }
      
      // Проверяем YouTube статус
      if (socialPlatforms && socialPlatforms.youtube && socialPlatforms.youtube.status === 'quota_exceeded') {
        console.log(`🎬 Контент ${content.id}: Сбрасываем YouTube quota_exceeded`);
        
        // Обновляем статус YouTube на pending для повторной попытки
        socialPlatforms.youtube.status = 'pending';
        socialPlatforms.youtube.error = null;
        socialPlatforms.youtube.updatedAt = new Date().toISOString();
        
        // Сохраняем изменения
        const updateResponse = await fetch(`${baseUrl}/items/campaign_content/${content.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            social_platforms: JSON.stringify(socialPlatforms)
          })
        });
        
        if (updateResponse.ok) {
          resetCount++;
          console.log(`✅ Контент ${content.id}: YouTube статус сброшен в pending`);
        } else {
          console.log(`❌ Контент ${content.id}: Ошибка обновления - ${updateResponse.status}`);
        }
      }
    }
    
    console.log(`\n🎯 РЕЗУЛЬТАТ:`);
    console.log(`- Проанализировано записей: ${allContent.length}`);
    console.log(`- Сброшено quota_exceeded статусов: ${resetCount}`);
    console.log(`\n💡 Теперь планировщик сможет повторно попробовать публикацию YouTube контента`);
    
  } catch (error) {
    console.error('❌ Ошибка сброса quota_exceeded статусов:', error.message);
  }
}

// Запускаем скрипт
resetYouTubeQuotas();