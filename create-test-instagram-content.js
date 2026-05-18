/**
 * Создание тестового контента для Instagram публикации через основной API
 */
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function createTestInstagramContent() {
  console.log('🚀 Создаем тестовый контент для Instagram публикации...');
  
  const SERVER_URL = 'http://localhost:5000';
  const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
  
  if (!DIRECTUS_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не настроен');
    return;
  }
  
  try {
    // Создаем тестовый контент
    const contentData = {
      title: 'Тестовый пост Instagram',
      content: '🚀 Тестовый пост для проверки Instagram публикации через SMM Manager! Система работает корректно! #test #instagram #smm',
      image_url: 'https://picsum.photos/1080/1080?random=4',
      content_type: 'text-image',
      campaign_id: '46868c44-c6a4-4bed-accf-9ad07bba790e', // Используем существующую кампанию
      user_id: '53921f16-f51d-4591-80b9-8caa4fde4d13', // ID пользователя из системы
      social_platforms: {
        instagram: {
          status: 'pending',
          enabled: true
        }
      },
      scheduled_at: new Date().toISOString(),
      status: 'scheduled'
    };
    
    console.log('📝 Создаем контент в Directus...');
    
    // Создаем контент через Directus API
    const directusResponse = await axios.post(`${process.env.DIRECTUS_URL}/items/campaign_content`, contentData, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Контент создан с ID:', directusResponse.data.data.id);
    
    // Теперь отправляем этот контент на публикацию через N8N
    const publishData = {
      content: contentData.content,
      imageUrl: contentData.image_url,
      username: 'it.zhdanov',
      password: 'QtpZ3dh70307',
      contentId: directusResponse.data.data.id,
      timestamp: new Date().toISOString()
    };
    
    console.log('📤 Отправляем на публикацию через N8N webhook...');
    
    const webhookResponse = await axios.post(`${process.env.N8N_URL}/webhook/publish-instagram`, publishData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('✅ Webhook ответ:', webhookResponse.status);
    console.log('📋 Данные ответа:', webhookResponse.data);
    
    // Ждем немного и проверяем статус
    console.log('⏳ Ожидаем обработки...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Проверяем обновленный статус
    const updatedContent = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${directusResponse.data.data.id}`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    
    console.log('🔍 Обновленный статус контента:');
    console.log('ID:', updatedContent.data.data.id);
    console.log('Статус:', updatedContent.data.data.status);
    console.log('Instagram статус:', updatedContent.data.data.social_platforms?.instagram?.status);
    
    if (updatedContent.data.data.social_platforms?.instagram?.postUrl) {
      console.log('🔗 URL поста:', updatedContent.data.data.social_platforms.instagram.postUrl);
    }
    
    if (updatedContent.data.data.social_platforms?.instagram?.error) {
      console.log('❌ Ошибка:', updatedContent.data.data.social_platforms.instagram.error);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при создании тестового контента:', error.response?.data || error.message);
  }
}

createTestInstagramContent();