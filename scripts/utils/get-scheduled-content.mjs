// Скрипт для проверки получения запланированных публикаций
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function getScheduledContent() {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    console.log(`Проверка запланированных публикаций для пользователя: ${email}`);
    
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
        
        // Выводим детальную информацию о параметрах запроса
        console.log('\n📋 Параметры для запроса запланированных публикаций:');
        
        const params = {
          filter: {
            status: {
              _eq: 'scheduled'
            },
            scheduled_at: {
              _nnull: true
            }
          },
          sort: ['scheduled_at']
        };
        
        console.log(`URL: ${directusUrl}/items/campaign_content`);
        console.log(`Параметры: ${JSON.stringify(params, null, 2)}`);
        console.log(`Заголовки: Authorization: Bearer ***${token.substring(token.length - 10)}`);
        
        try {
          console.log('\n📋 Попытка 1: Через query параметры');
          const response1 = await axios.get(`${directusUrl}/items/campaign_content`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            params: params
          });
          
          console.log('✅ Запрос успешно выполнен');
          console.log(`Получено элементов: ${response1.data.data.length}`);
          console.log(`Первые 3 элемента: ${JSON.stringify(response1.data.data.slice(0, 3).map(item => ({ id: item.id, title: item.title })), null, 2)}`);
        } catch (error) {
          console.log('❌ Ошибка при выполнении запроса (Попытка 1):');
          console.log(`Код ошибки: ${error.response?.status}`);
          console.log(`Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
          
          // Попытка 2: Запрос с явной строкой фильтрации
          try {
            console.log('\n📋 Попытка 2: С явной строкой фильтра');
            const filterStr = "filter[status][_eq]=scheduled&filter[scheduled_at][_nnull]=true&sort=scheduled_at";
            const response2 = await axios.get(`${directusUrl}/items/campaign_content?${filterStr}`, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            
            console.log('✅ Запрос успешно выполнен');
            console.log(`Получено элементов: ${response2.data.data.length}`);
            console.log(`Первые 3 элемента: ${JSON.stringify(response2.data.data.slice(0, 3).map(item => ({ id: item.id, title: item.title })), null, 2)}`);
          } catch (error) {
            console.log('❌ Ошибка при выполнении запроса (Попытка 2):');
            console.log(`Код ошибки: ${error.response?.status}`);
            console.log(`Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
            
            // Попытка 3: Простой запрос без фильтра
            try {
              console.log('\n📋 Попытка 3: Без фильтра, получаем все элементы');
              const response3 = await axios.get(`${directusUrl}/items/campaign_content`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });
              
              console.log('✅ Запрос успешно выполнен');
              console.log(`Получено элементов: ${response3.data.data.length}`);
              console.log(`Первые 3 элемента: ${JSON.stringify(response3.data.data.slice(0, 3).map(item => ({ id: item.id, title: item.title })), null, 2)}`);
              
              // Фильтруем запланированные публикации на стороне клиента
              const now = new Date();
              const scheduledContent = response3.data.data.filter(item => {
                return item.status === 'scheduled' && item.scheduled_at && new Date(item.scheduled_at) <= now;
              });
              
              console.log(`\nОтфильтрованные запланированные публикации: ${scheduledContent.length}`);
              console.log(`Детали: ${JSON.stringify(scheduledContent.map(item => ({
                id: item.id,
                title: item.title,
                status: item.status,
                scheduled_at: item.scheduled_at
              })), null, 2)}`);
            } catch (error) {
              console.log('❌ Ошибка при выполнении запроса (Попытка 3):');
              console.log(`Код ошибки: ${error.response?.status}`);
              console.log(`Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
            }
          }
        }
      } else {
        console.log('❌ Авторизация не удалась: Нет токена в ответе');
      }
    } catch (error) {
      console.log('❌ Ошибка авторизации:');
      console.log(`Код ошибки: ${error.response?.status}`);
      console.log(`Сообщение: ${error.response?.data?.errors?.[0]?.message}`);
    }
  } catch (error) {
    console.error('Общая ошибка:', error);
  }
}

getScheduledContent();