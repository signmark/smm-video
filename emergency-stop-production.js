/**
 * ЭКСТРЕННАЯ ОСТАНОВКА ПЛАНИРОВЩИКА НА PRODUCTION СЕРВЕРЕ
 * Срочно отключает планировщик для предотвращения массовых публикаций
 */

import axios from 'axios';

async function emergencyStopProduction() {
  console.log('🚨 ЭКСТРЕННАЯ ОСТАНОВКА PRODUCTION СЕРВЕРА');
  console.log('🛑 Попытка отключения планировщика на directus.nplanner.ru');
  
  const productionUrl = 'https://smm.omemo.tech'; // Production URL
  
  try {
    // 1. Попытка отключить планировщик через API
    console.log('1. Отключение планировщика через API...');
    
    const stopResponse = await axios.post(`${productionUrl}/api/publish/stop-scheduler`, {
      emergency: true,
      reason: 'Mass publications detected'
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Планировщик отключен через API:', stopResponse.data);
    
  } catch (apiError) {
    console.log('❌ API отключение не удалось:', apiError.message);
    
    // 2. Попытка блокировки через флаг в Directus
    try {
      console.log('2. Установка флага экстренной остановки в Directus...');
      
      // Авторизация в Directus
      const authResponse = await axios.post('https://directus.nplanner.ru/auth/login', {
        email: process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com',
        password: process.env.DIRECTUS_ADMIN_PASSWORD
      });
      
      const token = authResponse.data.data.access_token;
      
      // Создание записи экстренной остановки
      await axios.post('https://directus.nplanner.ru/items/system_flags', {
        key: 'emergency_stop_scheduler',
        value: 'true',
        reason: 'Mass publications detected - immediate stop required',
        created_at: new Date().toISOString()
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('✅ Флаг экстренной остановки установлен в Directus');
      
    } catch (directusError) {
      console.log('❌ Блокировка через Directus не удалась:', directusError.message);
    }
  }
  
  // 3. Проверка статуса планировщика
  try {
    console.log('3. Проверка статуса планировщика...');
    
    const statusResponse = await axios.get(`${productionUrl}/api/publish/scheduler-status`, {
      timeout: 5000
    });
    
    console.log('📊 Статус планировщика:', statusResponse.data);
    
  } catch (statusError) {
    console.log('❌ Не удалось получить статус планировщика:', statusError.message);
  }
  
  // 4. Рекомендации
  console.log('\n📋 СЛЕДУЮЩИЕ ШАГИ:');
  console.log('1. Проверьте логи production сервера на прекращение публикаций');
  console.log('2. Если планировщик все еще работает - перезапустите production сервер');
  console.log('3. Убедитесь что в БД нет контента со статусом "scheduled"');
  console.log('4. Восстановите службу только после устранения причин');
  
  return {
    emergency_stop_attempted: true,
    timestamp: new Date().toISOString(),
    target_server: productionUrl
  };
}

// Запуск экстренной остановки
emergencyStopProduction()
  .then(result => {
    console.log('\n🎯 РЕЗУЛЬТАТ ЭКСТРЕННОЙ ОСТАНОВКИ:', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.log('\n⚠️  РЕКОМЕНДАЦИЯ: Остановите production сервер вручную!');
    process.exit(1);
  });