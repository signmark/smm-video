// Проверка прав доступа к коллекциям Directus
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function checkPermissions() {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    console.log(`Проверка прав доступа для пользователя: ${email}`);
    
    // Шаг 1: Авторизация
    let token;
    try {
      const authResponse = await axios.post(`${directusUrl}/auth/login`, {
        email,
        password
      });
      
      if (authResponse.data?.data?.access_token) {
        token = authResponse.data.data.access_token;
        console.log(`✅ Авторизация успешна, токен: ***${token.substring(token.length - 10)}`);
        
        // Шаг 2: Получение информации о текущем пользователе
        try {
          const userResponse = await axios.get(`${directusUrl}/users/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          console.log('✅ Получение информации о пользователе: Успешно');
          console.log(`   ID: ${userResponse.data.data.id}`);
          console.log(`   Email: ${userResponse.data.data.email}`);
          console.log(`   Role: ${userResponse.data.data.role}`);
          
          // Сохраняем ID роли для последующей проверки
          const roleId = userResponse.data.data.role;
          
          // Шаг 3: Проверка прав для роли
          try {
            const roleResponse = await axios.get(`${directusUrl}/roles/${roleId}`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log('✅ Информация о роли:');
            console.log(`   Название: ${roleResponse.data.data.name}`);
            console.log(`   Системная: ${roleResponse.data.data.system ? 'Да' : 'Нет'}`);
            console.log(`   Права админа: ${roleResponse.data.data.admin_access ? 'Да' : 'Нет'}`);
          } catch (error) {
            console.log('❌ Не удалось получить информацию о роли:');
            console.log(`   Код: ${error.response?.status}`);
            console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
          }
          
        } catch (error) {
          console.log('❌ Не удалось получить информацию о пользователе:');
          console.log(`   Код: ${error.response?.status}`);
          console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
        }
        
        // Шаг 4: Проверка доступа к коллекциям
        const collections = [
          'user_campaigns', 
          'campaign_content', 
          'content_sources',
          'campaign_trend_topics',
          'social_publications'
        ];
        
        console.log('\n📋 Проверка доступа к коллекциям:');
        
        for (const collection of collections) {
          try {
            const response = await axios.get(`${directusUrl}/items/${collection}?limit=1`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log(`✅ ${collection}: Доступ разрешен, элементов: ${response.data.data.length}`);
          } catch (error) {
            console.log(`❌ ${collection}: Доступ запрещен`);
            console.log(`   Код: ${error.response?.status}`);
            console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
          }
        }
        
        // Шаг 5: Проверка возможности создания записей
        console.log('\n📋 Проверка возможности создания записей:');
        
        // Пробуем создать тестовую запись в campaign_content
        try {
          const testContent = {
            title: 'Test Content from Permissions Check',
            content: 'This is a test content for permission checking.',
            campaign_id: null,
            content_type: 'text',
            status: 'draft',
            user_id: userResponse.data.data.id
          };
          
          const createResponse = await axios.post(`${directusUrl}/items/campaign_content`, testContent, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          console.log('✅ Создание записи в campaign_content: Успешно');
          console.log(`   ID: ${createResponse.data.data.id}`);
          
          // Удаляем тестовую запись
          try {
            await axios.delete(`${directusUrl}/items/campaign_content/${createResponse.data.data.id}`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log('✅ Удаление тестовой записи: Успешно');
          } catch (error) {
            console.log('❌ Не удалось удалить тестовую запись:');
            console.log(`   Код: ${error.response?.status}`);
            console.log(`   Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
          }
        } catch (error) {
          console.log('❌ Не удалось создать запись в campaign_content:');
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

checkPermissions();