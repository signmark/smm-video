// Проверка входа в систему Directus
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function login() {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD || ''; // Вы должны указать пароль в .env файле
    
    if (!email || !password) {
      console.log('Не указаны email или пароль в переменных окружения');
      return;
    }
    
    console.log(`Попытка входа пользователя: ${email}`);
    
    try {
      const response = await axios.post(`${directusUrl}/auth/login`, {
        email,
        password
      });
      
      if (response.data?.data?.access_token) {
        console.log('Вход выполнен успешно!');
        console.log(`Access Token: ***${response.data.data.access_token.substring(response.data.data.access_token.length - 10)}`);
        console.log(`Refresh Token: ***${response.data.data.refresh_token.substring(response.data.data.refresh_token.length - 10)}`);
        console.log(`Expires: ${new Date(response.data.data.expires).toLocaleString()}`);
        
        const token = response.data.data.access_token;
        
        // Проверяем полученный токен
        const userResponse = await axios.get(`${directusUrl}/users/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log('\nИнформация о пользователе:');
        console.log(`ID: ${userResponse.data.data.id}`);
        console.log(`Email: ${userResponse.data.data.email}`);
        console.log(`Имя: ${userResponse.data.data.first_name} ${userResponse.data.data.last_name}`);
        console.log(`Роль: ${userResponse.data.data.role.name}`);
        
        // Проверяем права доступа
        console.log('\nПроверка доступа к коллекциям:');
        const collections = ['campaign_content', 'user_campaigns'];
        
        for (const collection of collections) {
          try {
            const response = await axios.get(`${directusUrl}/items/${collection}?limit=1`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log(`✅ ${collection}: доступ разрешен, статус ${response.status}`);
          } catch (error) {
            console.log(`❌ ${collection}: доступ запрещен, статус ${error.response?.status}`);
            if (error.response?.data?.errors) {
              console.log(`   Сообщение: ${error.response.data.errors[0]?.message}`);
            }
          }
        }
        
        return token;
      } else {
        console.log('Не удалось получить токен, нет access_token в ответе');
      }
    } catch (error) {
      console.error('Ошибка входа:', error.message);
      if (error.response?.data?.errors) {
        console.error('Детали ошибки:', error.response.data.errors[0].message);
      }
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

login();