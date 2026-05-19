const axios = require('axios');
require('dotenv').config();

/**
 * Тестовый скрипт для проверки сохранения Instagram настроек в кампанию
 */

async function testInstagramSettingsSave() {
  console.log('🧪 Тестирование сохранения Instagram настроек в кампанию');
  
  const campaignId = '46868c44-c6a4-4bed-accf-9ad07bba790e';
  const testData = {
    appId: '1234567890123456',
    appSecret: 'test_app_secret_real_12345',
    instagramId: '17841422578516105',
    accessToken: 'EAALyiQk1I8oBOZC2FZBZA1j3WVlTD3x4nKwJCnHZCSfake_token_for_testing_purposes_only'
  };
  
  try {
    console.log('\n1. Сохраняем Instagram настройки в кампанию...');
    console.log('Данные для сохранения:', {
      appId: testData.appId,
      appSecret: testData.appSecret.substring(0, 10) + '...',
      instagramId: testData.instagramId,
      accessToken: testData.accessToken.substring(0, 20) + '...'
    });
    
    // Отправляем настройки
    const saveResponse = await axios.patch(
      `http://localhost:5000/api/campaigns/${campaignId}/instagram-settings`,
      testData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTczMjM0MTc3NSwiZXhwIjoxNzMyNDI4MTc1LCJpc3MiOiJkaXJlY3R1cyJ9.5yXhWkkFhz5qBXjIQWmHFfg9TdP52H4_h9VNx6R0IrY`
        }
      }
    );
    
    console.log('✅ Instagram настройки сохранены:', {
      success: saveResponse.data.success,
      message: saveResponse.data.message
    });
    
    console.log('\n2. Проверяем сохраненные настройки...');
    
    // Проверяем что настройки действительно сохранились
    const getResponse = await axios.get(
      `http://localhost:5000/api/campaigns/${campaignId}`,
      {
        headers: {
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTczMjM0MTc3NSwiZXhwIjoxNzMyNDI4MTc1LCJpc3MiOiJkaXJlY3R1cyJ9.5yXhWkkFhz5qBXjIQWmHFfg9TdP52H4_h9VNx6R0IrY`
        }
      }
    );
    
    const socialMediaSettings = getResponse.data.data?.social_media_settings;
    const instagramSettings = socialMediaSettings?.instagram;
    
    console.log('📋 Сохраненные Instagram настройки:', {
      hasInstagramSettings: !!instagramSettings,
      appId: instagramSettings?.appId,
      hasAppSecret: !!instagramSettings?.appSecret,
      instagramId: instagramSettings?.instagramId,
      hasAccessToken: !!instagramSettings?.accessToken,
      accessTokenPreview: instagramSettings?.accessToken?.substring(0, 20) + '...'
    });
    
    if (instagramSettings) {
      console.log('✅ Все Instagram настройки корректно сохранены в JSON');
      
      // Проверяем конкретные значения
      const checks = [
        { field: 'appId', expected: testData.appId, actual: instagramSettings.appId },
        { field: 'appSecret', expected: testData.appSecret, actual: instagramSettings.appSecret },
        { field: 'instagramId', expected: testData.instagramId, actual: instagramSettings.instagramId },
        { field: 'accessToken', expected: testData.accessToken, actual: instagramSettings.accessToken }
      ];
      
      console.log('\n📊 Проверка целостности данных:');
      checks.forEach(check => {
        const isValid = check.expected === check.actual;
        console.log(`${isValid ? '✅' : '❌'} ${check.field}: ${isValid ? 'OK' : 'MISMATCH'}`);
        if (!isValid) {
          console.log(`   Ожидается: ${check.expected}`);
          console.log(`   Получено:  ${check.actual}`);
        }
      });
      
    } else {
      console.log('❌ Instagram настройки не найдены в social_media_settings');
    }
    
    console.log('\n✅ Тест сохранения настроек завершен');
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Запуск тестирования
testInstagramSettingsSave();