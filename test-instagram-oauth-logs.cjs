const axios = require('axios');
require('dotenv').config();

/**
 * Тестовый скрипт для проверки логов Instagram OAuth callback
 */

async function testInstagramOAuthLogs() {
  console.log('🧪 Тестирование Instagram OAuth логов');
  
  const campaignId = '46868c44-c6a4-4bed-accf-9ad07bba790e';
  const testData = {
    appId: '1234567890123456',
    appSecret: 'test_app_secret_12345',
    redirectUri: 'http://localhost:5000/instagram-callback',
    webhookUrl: 'https://n8n.roboflow.space/webhook/instagram-auth',
    instagramId: '17841422578516105',
    campaignId: campaignId
  };
  
  try {
    console.log('\n1. Запускаем OAuth flow...');
    
    // Шаг 1: Запуск OAuth flow
    const startResponse = await axios.post(
      'http://localhost:5000/api/instagram/auth/start',
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('OAuth flow запущен:', {
      hasAuthUrl: !!startResponse.data.authUrl,
      state: startResponse.data.state
    });
    
    console.log('\n2. Симулируем callback с тестовыми данными...');
    
    // Шаг 2: Симуляция callback (вместо реального Facebook OAuth)
    // В реальном потоке Facebook вернул бы код авторизации
    const mockCode = 'AQD8test_authorization_code_from_facebook_oauth_flow_12345';
    const state = startResponse.data.state;
    
    console.log('Данные для callback:', {
      code: mockCode.substring(0, 20) + '...',
      state: state
    });
    
    // Симулируем callback
    // Примечание: Этот вызов завершится ошибкой на этапе обмена кода на токен,
    // так как используется тестовый код, но мы увидим логи до этого момента
    try {
      const callbackResponse = await axios.get(
        `http://localhost:5000/api/instagram/auth/callback?code=${mockCode}&state=${state}`,
        {
          timeout: 10000
        }
      );
      
      console.log('✅ Callback completed successfully:', callbackResponse.data);
    } catch (callbackError) {
      if (callbackError.response) {
        console.log('📋 Callback response (expected error):', {
          status: callbackError.response.status,
          error: callbackError.response.data?.error || 'Unknown error',
          details: callbackError.response.data?.details
        });
        console.log('ℹ️  Это ожидаемая ошибка - используется тестовый код авторизации');
      } else {
        console.log('❌ Network error:', callbackError.message);
      }
    }
    
    console.log('\n✅ Тест логов завершен - проверьте серверные логи выше');
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Запуск тестирования
testInstagramOAuthLogs();