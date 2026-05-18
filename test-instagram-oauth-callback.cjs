#!/usr/bin/env node

const axios = require('axios');

async function testInstagramOAuthCallback() {
  console.log('🔥 Тестирование Instagram OAuth Callback');
  
  const testData = {
    code: 'test_code_123',
    state: 'test_state_' + Date.now()
  };
  
  // Сначала создадим тестовую сессию
  const sessionData = {
    appId: '1234567890123456',
    appSecret: 'test_secret',
    campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
    redirectUri: 'http://localhost:3000/instagram-callback',
    webhookUrl: 'https://n8n.roboflow.space/webhook/instagram-auth'
  };
  
  try {
    console.log('1. Создаем OAuth сессию...');
    
    // Симулируем создание сессии (обычно это делается в /api/instagram/auth/start)
    // В реальности эта сессия создается при запуске OAuth процесса
    console.log(`Тестовая сессия: ${JSON.stringify(sessionData, null, 2)}`);
    
    console.log('2. Проверяем текущие настройки Instagram в кампании...');
    
    const currentSettingsResponse = await axios.get(
      `https://directus.roboflow.space/items/user_campaigns/46868c44-c6a4-4bed-accf-9ad07bba790e`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const currentInstagram = currentSettingsResponse.data.data.social_media_settings?.instagram;
    console.log('Текущие Instagram настройки:');
    console.log(JSON.stringify(currentInstagram, null, 2));
    
    if (currentInstagram?.token) {
      console.log('✅ Instagram токен уже существует в базе данных');
      console.log(`📊 Токен: ${currentInstagram.token.substring(0, 20)}...`);
      console.log(`📊 Business Account ID: ${currentInstagram.businessAccountId}`);
    } else {
      console.log('❌ Instagram токен не найден в базе данных');
    }
    
    console.log('\n3. Тестирование логики обновления настроек...');
    
    // Симулируем данные, которые пришли бы из Facebook API
    const mockFacebookResponse = {
      longLivedToken: 'EAA_new_token_from_oauth_' + Date.now(),
      expiresIn: 'never', // Instagram tokens не истекают
      user: {
        id: 'test_user_id',
        name: 'Test User'
      },
      instagramAccounts: [
        {
          instagramId: '17841422578516105',
          username: 'test_instagram_account',
          name: 'Test Instagram Business'
        }
      ]
    };
    
    // Симулируем логику объединения настроек
    const existingInstagram = currentInstagram || {};
    const newInstagramSettings = {
      appId: sessionData.appId,
      longLivedToken: mockFacebookResponse.longLivedToken,
      expiresIn: mockFacebookResponse.expiresIn,
      tokenExpiresAt: null, // для "never"
      user: mockFacebookResponse.user,
      instagramAccounts: mockFacebookResponse.instagramAccounts,
      authTimestamp: new Date().toISOString(),
      status: 'active'
    };
    
    const updatedInstagramSettings = {
      ...existingInstagram,
      ...newInstagramSettings,
      token: existingInstagram.token || newInstagramSettings.longLivedToken,
      businessAccountId: existingInstagram.businessAccountId || 
        (newInstagramSettings.instagramAccounts[0] ? 
          newInstagramSettings.instagramAccounts[0].instagramId : null)
    };
    
    console.log('Результат объединения настроек:');
    console.log(JSON.stringify(updatedInstagramSettings, null, 2));
    
    console.log('\n✅ Тест завершен успешно');
    console.log(`🔑 Финальный токен: ${updatedInstagramSettings.token?.substring(0, 20)}...`);
    console.log(`📊 Business Account ID: ${updatedInstagramSettings.businessAccountId}`);
    
  } catch (error) {
    console.error('❌ Ошибка теста:', error.message);
    if (error.response) {
      console.error('📋 Ответ сервера:', error.response.data);
    }
  }
}

testInstagramOAuthCallback();