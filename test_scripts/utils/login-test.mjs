// Тестирование авторизации через логин/пароль
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function loginTest() {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    console.log(`Тестирование авторизации для пользователя: ${email}`);
    
    try {
      const response = await axios.post(`${directusUrl}/auth/login`, {
        email,
        password
      });
      
      if (response.data?.data?.access_token) {
        console.log('✅ Авторизация успешна!');
        console.log(`✅ Access Token: ***${response.data.data.access_token.substring(response.data.data.access_token.length - 10)}`);
        console.log(`✅ Refresh Token: ***${response.data.data.refresh_token.substring(response.data.data.refresh_token.length - 10)}`);
        console.log(`✅ Токен действителен до: ${new Date(response.data.data.expires).toLocaleString()}`);
        
        // Проверяем возможность доступа к API с полученным токеном
        console.log('\nПроверка доступа к API с полученным токеном:');
        const token = response.data.data.access_token;
        
        try {
          // Проверяем информацию о пользователе
          const userResponse = await axios.get(`${directusUrl}/users/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          console.log('✅ Получение информации о пользователе: Успешно');
          console.log(`   ID: ${userResponse.data.data.id}`);
          console.log(`   Email: ${userResponse.data.data.email}`);
          
          // Проверяем доступ к коллекции campaign_content
          try {
            const contentResponse = await axios.get(`${directusUrl}/items/campaign_content?limit=1`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log('✅ Доступ к коллекции campaign_content: Успешно');
            console.log(`   Найдено элементов: ${contentResponse.data.data.length}`);
          } catch (error) {
            console.log('❌ Доступ к коллекции campaign_content: Ошибка');
            console.log(`   Код: ${error.response?.status}`);
            console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
          }
        } catch (error) {
          console.log('❌ Получение информации о пользователе: Ошибка');
          console.log(`   Код: ${error.response?.status}`);
          console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
        }
      } else {
        console.log('❌ Авторизация не удалась: Нет токена в ответе');
      }
    } catch (error) {
      console.log('❌ Ошибка авторизации:');
      console.log(`   Код: ${error.response?.status}`);
      console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
    }
  } catch (error) {
    console.error('Общая ошибка:', error);
  }
}

loginTest();