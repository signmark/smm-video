/**
 * Скрипт для проверки статуса тестовой публикации в Instagram через Directus
 */
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function checkInstagramTestStatus() {
  console.log('🔍 Проверяем статус тестовой Instagram публикации...');
  
  const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
  const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
  
  if (!DIRECTUS_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не настроен в переменных окружения');
    return;
  }
  
  console.log(`📡 Directus URL: ${DIRECTUS_URL}`);
  
  try {
    // Получаем последние записи из campaign_content, отсортированные по дате создания
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      },
      params: {
        limit: 10,
        fields: [
          'id',
          'content',
          'social_platforms',
          'status',
          'scheduled_at'
        ]
      }
    });
    
    console.log(`📊 Найдено ${response.data.data.length} записей контента`);
    
    // Ищем записи с Instagram публикацией
    const instagramContent = response.data.data.filter(item => {
      const socialPlatforms = item.social_platforms;
      return socialPlatforms && 
             typeof socialPlatforms === 'object' && 
             socialPlatforms.instagram;
    });
    
    console.log(`📱 Найдено ${instagramContent.length} записей с Instagram публикацией`);
    
    if (instagramContent.length > 0) {
      console.log('\n📋 Последние Instagram публикации:');
      
      instagramContent.forEach((item, index) => {
        const instagramData = item.social_platforms.instagram;
        console.log(`\n${index + 1}. ID: ${item.id}`);
        console.log(`   Контент: ${item.content?.substring(0, 100)}...`);
        console.log(`   Статус: ${item.status}`);
        console.log(`   Instagram статус: ${instagramData.status || 'не указан'}`);
        if (instagramData.error) {
          console.log(`   ❌ Ошибка: ${instagramData.error}`);
        }
        
        if (instagramData.postUrl) {
          console.log(`   🔗 URL поста: ${instagramData.postUrl}`);
        }
      });
    } else {
      console.log('📭 Записей с Instagram публикацией не найдено');
    }
    
    // Проверяем также записи с тестовым контентом
    const testContent = response.data.data.filter(item => 
      item.content && item.content.includes('тест')
    );
    
    if (testContent.length > 0) {
      console.log('\n🧪 Тестовый контент:');
      testContent.forEach((item, index) => {
        console.log(`\n${index + 1}. ID: ${item.id}`);
        console.log(`   Контент: ${item.content?.substring(0, 100)}...`);
        console.log(`   Статус: ${item.status}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка при проверке статуса публикации:');
    
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', error.response.data);
    } else {
      console.error('Ошибка запроса:', error.message);
    }
  }
}

// Запускаем проверку
checkInstagramTestStatus();