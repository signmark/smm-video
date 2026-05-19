/**
 * Экстренная остановка через прямое обновление базы данных
 * Выполняет SQL-запросы на production сервере directus.nplanner.ru
 */

import axios from 'axios';

const PRODUCTION_DIRECTUS_URL = 'https://directus.nplanner.ru';
const ADMIN_EMAIL = 'lbrspb@gmail.com';

async function emergencyStopDatabase() {
  console.log('🚨 ЭКСТРЕННАЯ ОСТАНОВКА: Обращение к production базе данных');
  
  try {
    // 1. Авторизация в Directus
    console.log('1. Авторизация в production Directus...');
    const authResponse = await axios.post(`${PRODUCTION_DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: process.env.DIRECTUS_ADMIN_PASSWORD || 'your_password_here'
    });
    
    const token = authResponse.data.data.access_token;
    console.log('✅ Авторизация успешна');
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // 2. Получить текущее состояние
    console.log('2. Анализ текущего состояния контента...');
    const contentResponse = await axios.get(`${PRODUCTION_DIRECTUS_URL}/items/campaign_content?filter[status][_eq]=scheduled&limit=50`, {
      headers
    });
    
    const scheduledContent = contentResponse.data.data;
    console.log(`Найдено ${scheduledContent.length} контентов со статусом 'scheduled'`);
    
    // 3. Массовое обновление через PATCH
    if (scheduledContent.length > 0) {
      console.log('3. Массовое обновление статусов на draft...');
      
      const contentIds = scheduledContent.map(item => item.id);
      
      // Обновляем статус всех scheduled контентов на draft
      const updateResponse = await axios.patch(`${PRODUCTION_DIRECTUS_URL}/items/campaign_content`, {
        keys: contentIds,
        data: {
          status: 'draft'
        }
      }, { headers });
      
      console.log(`✅ Обновлено ${contentIds.length} контентов: scheduled → draft`);
    }
    
    // 4. Исправление проблемных Facebook публикаций
    console.log('4. Поиск проблемных Facebook публикаций...');
    const facebookResponse = await axios.get(`${PRODUCTION_DIRECTUS_URL}/items/campaign_content?limit=100`, {
      headers
    });
    
    let fixedFacebook = 0;
    for (const content of facebookResponse.data.data) {
      if (content.social_platforms?.facebook?.status === 'published' && 
          (!content.social_platforms?.facebook?.postUrl || content.social_platforms?.facebook?.postUrl === '')) {
        
        // Исправляем проблемную запись
        const updatedPlatforms = {
          ...content.social_platforms,
          facebook: {
            ...content.social_platforms.facebook,
            status: 'not_selected',
            selected: false
          }
        };
        
        await axios.patch(`${PRODUCTION_DIRECTUS_URL}/items/campaign_content/${content.id}`, {
          social_platforms: updatedPlatforms
        }, { headers });
        
        fixedFacebook++;
      }
    }
    
    if (fixedFacebook > 0) {
      console.log(`✅ Исправлено ${fixedFacebook} проблемных Facebook записей`);
    }
    
    // 5. Создание флага экстренной остановки
    console.log('5. Установка флага экстренной остановки...');
    try {
      await axios.post(`${PRODUCTION_DIRECTUS_URL}/items/directus_settings`, {
        project: 'default',
        key: 'emergency_stop_scheduler',
        value: 'true'
      }, { headers });
      console.log('✅ Флаг экстренной остановки установлен');
    } catch (flagError) {
      console.log('⚠️  Флаг экстренной остановки не установлен (возможно уже существует)');
    }
    
    // 6. Финальная проверка
    console.log('6. Финальная проверка состояния...');
    const finalCheck = await axios.get(`${PRODUCTION_DIRECTUS_URL}/items/campaign_content?filter[status][_eq]=scheduled&limit=1`, {
      headers
    });
    
    console.log(`Осталось контентов со статусом 'scheduled': ${finalCheck.data.data.length}`);
    
    if (finalCheck.data.data.length === 0) {
      console.log('🎯 УСПЕХ: Все запланированные публикации остановлены');
    } else {
      console.log('⚠️  ВНИМАНИЕ: Остались запланированные публикации');
    }
    
    return {
      success: true,
      stopped_content: scheduledContent.length,
      fixed_facebook: fixedFacebook,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    if (error.response?.data) {
      console.error('Детали ошибки:', error.response.data);
    }
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Запуск экстренной остановки
emergencyStopDatabase()
  .then(result => {
    console.log('\n📊 РЕЗУЛЬТАТ ЭКСТРЕННОЙ ОСТАНОВКИ:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n✅ МАССОВЫЕ ПУБЛИКАЦИИ ОСТАНОВЛЕНЫ');
      console.log('📋 Следующие шаги:');
      console.log('1. Перезапустите production сервер для полной остановки планировщика');
      console.log('2. Проверьте логи на отсутствие новых публикаций');
      console.log('3. Устраните причину бесконечного цикла перед восстановлением');
    } else {
      console.log('\n❌ ОСТАНОВКА НЕ УДАЛАСЬ - ТРЕБУЕТСЯ РУЧНОЕ ВМЕШАТЕЛЬСТВО');
    }
    
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('\n💥 ФАТАЛЬНАЯ ОШИБКА:', error.message);
    console.log('\n🆘 ТРЕБУЕТСЯ ЭКСТРЕННОЕ РУЧНОЕ ВМЕШАТЕЛЬСТВО НА СЕРВЕРЕ');
    process.exit(1);
  });