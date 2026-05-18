#!/usr/bin/env node

/**
 * Тестовый скрипт для публикации в Instagram через N8N workflow
 * Отправляет тестовый пост с изображением в Instagram
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Настройки
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://n8n.nplanner.ru/webhook/publish-instagram';
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

// Тестовые данные для поста
const testPostData = {
  content: "🚀 Тестовый пост из SMM Manager! Автоматическая публикация через N8N workflow работает отлично! #SMM #автоматизация #Instagram #тест",
  imageUrl: "https://picsum.photos/1080/1080", // Случайное изображение для теста
  contentId: `test-${Date.now()}`,
  campaignId: "test-campaign",
  hashtags: ["#SMM", "#автоматизация", "#Instagram", "#тест"],
  location: null,
  caption: "🚀 Тестовый пост из SMM Manager! Автоматическая публикация через N8N workflow работает отлично! #SMM #автоматизация #Instagram #тест",
  
  // Настройки Instagram (нужны реальные данные)
  settings: {
    username: "your_instagram_username", // ЗАМЕНИТЬ НА РЕАЛЬНЫЕ ДАННЫЕ
    password: "your_instagram_password"  // ЗАМЕНИТЬ НА РЕАЛЬНЫЕ ДАННЫЕ
  }
};

async function testInstagramPost() {
  console.log('🔥 Тестируем публикацию в Instagram через N8N...');
  console.log('📝 Данные поста:', {
    content: testPostData.content.substring(0, 50) + '...',
    imageUrl: testPostData.imageUrl,
    contentId: testPostData.contentId,
    hasCredentials: !!(testPostData.settings.username && testPostData.settings.password)
  });
  
  try {
    // Проверяем, что у нас есть учетные данные
    if (testPostData.settings.username === "your_instagram_username" || 
        testPostData.settings.password === "your_instagram_password") {
      console.log('❌ ОШИБКА: Нужно указать реальные учетные данные Instagram!');
      console.log('📝 Отредактируйте файл test-instagram-post.js и укажите:');
      console.log('   - username: ваш логин Instagram');
      console.log('   - password: ваш пароль Instagram');
      return;
    }
    
    console.log('📡 Отправляем запрос к N8N webhook...');
    
    // Отправляем данные в N8N webhook
    const response = await axios.post(N8N_WEBHOOK_URL, testPostData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SMM-Manager-Test/1.0'
      },
      timeout: 60000 // 60 секунд таймаут для публикации
    });
    
    console.log('✅ Ответ от N8N:', response.status);
    console.log('📄 Данные ответа:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log('🎉 УСПЕХ! Пост опубликован в Instagram!');
      console.log('🔗 URL поста:', response.data.postUrl);
    } else {
      console.log('❌ ОШИБКА публикации:', response.data.error);
      console.log('📝 Сообщение:', response.data.message);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании Instagram:', error.message);
    
    if (error.response) {
      console.log('📄 Ответ сервера:', error.response.status);
      console.log('📝 Данные ошибки:', JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.log('🔧 Проверьте, что N8N сервер запущен и доступен по адресу:', N8N_WEBHOOK_URL);
    }
  }
}

// Функция для получения реального контента из системы
async function getTestContentFromSystem() {
  if (!DIRECTUS_TOKEN) {
    console.log('⚠️  DIRECTUS_TOKEN не найден, используем тестовые данные');
    return testPostData;
  }
  
  try {
    console.log('📡 Получаем реальный контент из системы...');
    
    // Получаем контент из системы
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      },
      params: {
        limit: 1,
        filter: {
          content_type: 'text-image',
          status: 'draft'
        }
      }
    });
    
    if (response.data.data && response.data.data.length > 0) {
      const content = response.data.data[0];
      
      return {
        ...testPostData,
        content: content.content || testPostData.content,
        imageUrl: content.image_url || testPostData.imageUrl,
        contentId: content.id,
        campaignId: content.campaign_id || testPostData.campaignId
      };
    }
    
  } catch (error) {
    console.log('⚠️  Ошибка получения контента из системы:', error.message);
    console.log('📝 Используем тестовые данные');
  }
  
  return testPostData;
}

// Запуск теста
async function main() {
  console.log('🚀 Запуск теста Instagram публикации...');
  console.log('🔗 N8N Webhook URL:', N8N_WEBHOOK_URL);
  
  // Получаем данные для теста
  const postData = await getTestContentFromSystem();
  
  // Обновляем глобальные данные
  Object.assign(testPostData, postData);
  
  // Запускаем тест
  await testInstagramPost();
  
  console.log('✅ Тест завершен!');
}

// Запуск если файл выполняется напрямую
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testInstagramPost, testPostData };