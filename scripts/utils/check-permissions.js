// Файл для проверки прав доступа админского токена
const axios = require('axios');

async function checkPermissions() {
  try {
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
    
    if (!adminToken) {
      console.log('DIRECTUS_ADMIN_TOKEN не найден в переменных окружения');
      return;
    }
    
    // Проверяем доступ к различным коллекциям
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const collections = [
      'campaign_content',
      'user_campaigns',
      'content_sources',
      'trend_topics',
      'campaign_trend_topics'
    ];
    
    const results = {};
    
    // Пробуем тестовый запрос для проверки валидности токена
    try {
      const userResponse = await axios.get(`${directusUrl}/users/me`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      results.user = {
        valid: true,
        id: userResponse.data?.data?.id,
        email: userResponse.data?.data?.email,
        firstName: userResponse.data?.data?.first_name,
        lastName: userResponse.data?.data?.last_name,
        role: userResponse.data?.data?.role
      };
      
      console.log('Информация о пользователе токена:');
      console.log(JSON.stringify(results.user, null, 2));
    } catch (userError) {
      results.user = {
        valid: false,
        error: userError.message,
        status: userError.response?.status
      };
      console.log('Ошибка при получении информации о пользователе:');
      console.log(JSON.stringify(results.user, null, 2));
    }
    
    // Проверяем доступ к коллекциям
    console.log('\nПроверка доступа к коллекциям:');
    for (const collection of collections) {
      try {
        const response = await axios.get(`${directusUrl}/items/${collection}?limit=1`, {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        });
        
        results[collection] = {
          access: true,
          status: response.status,
          message: 'Доступ разрешен',
          data: !!response.data?.data?.length
        };
        
        console.log(`✅ ${collection}: доступ разрешен, статус ${response.status}, данные ${results[collection].data ? 'найдены' : 'не найдены'}`);
      } catch (error) {
        results[collection] = {
          access: false,
          status: error.response?.status,
          message: error.message,
          details: error.response?.data?.errors
        };
        
        console.log(`❌ ${collection}: доступ запрещен, статус ${error.response?.status}`);
        if (error.response?.data?.errors) {
          console.log(`   Сообщение: ${error.response.data.errors[0]?.message}`);
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Ошибка при проверке прав доступа:', error);
  }
}

// Запускаем функцию
checkPermissions();