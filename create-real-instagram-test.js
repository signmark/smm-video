/**
 * Создание тестового контента с реальным изображением для Instagram
 */
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function createRealInstagramTest() {
  console.log('🚀 Создаем реальный тест Instagram с проверенным изображением...');
  
  const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
  const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
  const SERVER_URL = 'http://localhost:5000';
  
  if (!DIRECTUS_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не настроен');
    return;
  }
  
  try {
    // Создаем контент с реальным изображением
    const contentData = {
      title: 'РЕАЛЬНЫЙ Instagram Тест',
      content: '🎯 РЕАЛЬНЫЙ тест Instagram API публикации! Проверяем работу системы с настоящим изображением. #test #instagram #api #realtest',
      image_url: 'https://i.imgur.com/9LRwEJS.jpg', // Проверенное изображение
      content_type: 'text-image',
      campaign_id: '46868c44-c6a4-4bed-accf-9ad07bba790e',
      user_id: '53921f16-f51d-4591-80b9-8caa4fde4d13',
      social_platforms: {
        instagram: {
          status: 'scheduled',
          enabled: true
        }
      },
      scheduled_at: new Date().toISOString(),
      status: 'scheduled'
    };
    
    console.log('📝 Создаем контент в Directus...');
    console.log('🖼️ Используем изображение:', contentData.image_url);
    
    const directusResponse = await axios.post(`${DIRECTUS_URL}/items/campaign_content`, contentData, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const contentId = directusResponse.data.data.id;
    console.log('✅ Контент создан с ID:', contentId);
    
    // Ждем немного для сохранения
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Проверяем создание через API
    console.log('🔍 Проверяем созданный контент...');
    const checkResponse = await axios.get(`${DIRECTUS_URL}/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    
    console.log('📋 Проверка контента:');
    console.log('  ID:', checkResponse.data.data.id);
    console.log('  Заголовок:', checkResponse.data.data.title);
    console.log('  Изображение:', checkResponse.data.data.image_url);
    console.log('  Статус:', checkResponse.data.data.status);
    
    // Теперь тестируем публикацию через тестовый маршрут
    console.log('\n📤 Запускаем тестовую публикацию...');
    
    const publishResponse = await axios.post(`${SERVER_URL}/api/test/instagram-publish`, {
      contentId: contentId
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('🎯 Результат публикации:');
    console.log('  Успех:', publishResponse.data.success);
    
    if (publishResponse.data.publication) {
      console.log('  Платформа:', publishResponse.data.publication.platform);
      console.log('  Статус:', publishResponse.data.publication.status);
      
      if (publishResponse.data.publication.error) {
        console.log('  ❌ Ошибка:', publishResponse.data.publication.error);
      }
      
      if (publishResponse.data.publication.postUrl) {
        console.log('  🔗 URL поста:', publishResponse.data.publication.postUrl);
      }
    }
    
    // Проверяем финальный статус
    if (publishResponse.data.instagram) {
      console.log('\n📊 Финальный статус Instagram:');
      console.log('  Статус:', publishResponse.data.instagram.status);
      console.log('  Дата обновления:', publishResponse.data.instagram.updatedAt);
      
      if (publishResponse.data.instagram.error) {
        console.log('  Ошибка:', publishResponse.data.instagram.error);
      }
    }
    
    console.log('\n✅ Тест завершен!');
    return contentId;
    
  } catch (error) {
    console.error('❌ Ошибка при создании теста:', error.response?.data || error.message);
    
    if (error.response?.status) {
      console.log('📊 HTTP статус:', error.response.status);
    }
  }
}

createRealInstagramTest();