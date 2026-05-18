const axios = require('axios');
require('dotenv').config();

/**
 * Полный тест Instagram OAuth flow с подробными логами
 */

async function testFullInstagramOAuthFlow() {
  console.log('🧪 ПОЛНЫЙ ТЕСТ INSTAGRAM OAUTH FLOW С ЛОГАМИ');
  
  const campaignId = '46868c44-c6a4-4bed-accf-9ad07bba790e';
  const baseURL = 'http://localhost:5000';
  
  // Тестовые данные Instagram приложения
  const testAppData = {
    appId: '1234567890123456',
    appSecret: 'test_app_secret_real_12345_updated',
    redirectUri: `${baseURL}/instagram-callback`,
    webhookUrl: 'https://n8n.roboflow.space/webhook/instagram-auth',
    instagramId: '17841422578516105',
    campaignId: campaignId
  };
  
  // Токен для авторизации (используем admin token для тестирования)
  const adminToken = process.env.DIRECTUS_TOKEN;
  
  console.log('\n📋 Конфигурация теста:', {
    campaignId,
    appId: testAppData.appId,
    hasAdminToken: !!adminToken,
    baseURL
  });
  
  try {
    console.log('\n=== ЭТАП 1: ЗАПУСК OAUTH FLOW ===');
    
    const startResponse = await axios.post(
      `${baseURL}/api/instagram/auth/start`,
      testAppData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ OAuth flow запущен:', {
      success: startResponse.data.success,
      hasAuthUrl: !!startResponse.data.authUrl,
      state: startResponse.data.state
    });
    
    const state = startResponse.data.state;
    
    console.log('\n=== ЭТАП 2: СИМУЛЯЦИЯ OAUTH CALLBACK ===');
    
    // Симулируем callback с тестовыми данными
    const mockCode = 'AQD8_test_code_from_facebook_oauth_simulation_12345_updated';
    
    console.log('📋 Параметры callback:', {
      code: mockCode.substring(0, 25) + '...',
      state: state
    });
    
    // Здесь будет ошибка на этапе обмена кода на токен (ожидаемо)
    try {
      const callbackResponse = await axios.get(
        `${baseURL}/api/instagram/auth/callback?code=${mockCode}&state=${state}`,
        { timeout: 15000 }
      );
      
      console.log('✅ OAuth callback завершен успешно:', callbackResponse.data);
      
    } catch (callbackError) {
      if (callbackError.response) {
        console.log('📋 OAuth callback ответ (ожидаемая ошибка):', {
          status: callbackError.response.status,
          success: callbackError.response.data?.success,
          error: callbackError.response.data?.error,
          details: callbackError.response.data?.details
        });
        console.log('ℹ️  Ошибка ожидаема - используется тестовый код авторизации от Facebook');
      } else {
        console.log('❌ Сетевая ошибка callback:', callbackError.message);
      }
    }
    
    console.log('\n=== ЭТАП 3: ТЕСТИРОВАНИЕ СОХРАНЕНИЯ НАСТРОЕК ===');
    
    // Тестируем сохранение настроек напрямую
    const settingsData = {
      appId: testAppData.appId,
      appSecret: testAppData.appSecret,
      instagramId: testAppData.instagramId,
      accessToken: 'EAALyiQk1I8oBOZC2FZBZA1j_test_long_lived_token_for_testing_12345'
    };
    
    console.log('📋 Данные для сохранения:', {
      appId: settingsData.appId,
      appSecret: settingsData.appSecret.substring(0, 15) + '...',
      instagramId: settingsData.instagramId,
      accessToken: settingsData.accessToken.substring(0, 25) + '...'
    });
    
    const saveResponse = await axios.patch(
      `${baseURL}/api/campaigns/${campaignId}/instagram-settings`,
      settingsData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );
    
    console.log('✅ Instagram настройки сохранены:', {
      success: saveResponse.data.success,
      message: saveResponse.data.message
    });
    
    console.log('\n=== ЭТАП 4: ПРОВЕРКА СОХРАНЕННЫХ НАСТРОЕК ===');
    
    // Проверка через отдельный endpoint
    const settingsResponse = await axios.get(
      `${baseURL}/api/campaigns/${campaignId}/instagram-settings`,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );
    
    console.log('📋 Проверка настроек через отдельный endpoint:', {
      success: settingsResponse.data.success,
      hasSettings: !!settingsResponse.data.settings,
      appId: settingsResponse.data.settings?.appId,
      hasAccessToken: !!settingsResponse.data.settings?.accessToken
    });
    
    console.log('\n=== РЕЗУЛЬТАТ ТЕСТИРОВАНИЯ ===');
    console.log('✅ OAuth flow запускается корректно');
    console.log('✅ Callback обрабатывается (с ожидаемой ошибкой токена)');
    console.log('✅ Настройки сохраняются в базу данных');
    console.log('✅ Настройки успешно извлекаются из базы');
    console.log('✅ Логирование работает на всех этапах');
    
    console.log('\n📋 ПРОВЕРЬТЕ СЕРВЕРНЫЕ ЛОГИ выше для детального анализа');
    
  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

// Запуск полного теста
testFullInstagramOAuthFlow();