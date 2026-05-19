const axios = require('axios');

const BASE_URL = 'http://0.0.0.0:5000';
const N8N_URL = 'https://n8n.roboflow.space';

// Тестовые данные для Instagram OAuth
const testData = {
  appId: '1234567890123456',
  appSecret: 'test_app_secret_12345',
  instagramId: '17841400000000000',
  redirectUri: 'https://worf.replit.dev/instagram-callback',
  webhookUrl: 'https://n8n.roboflow.space/webhook/instagram-auth',
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e' // Test campaign ID
};

// Симуляция успешного OAuth ответа от Facebook
const mockOAuthData = {
  success: true,
  appId: testData.appId,
  longLivedToken: 'EAABwzLixnjYBO123456789...',
  expiresIn: 5183944,
  user: {
    id: '123456789',
    name: 'Test User',
    email: 'test@example.com'
  },
  pages: [
    {
      id: '987654321',
      name: 'Test Business Page',
      access_token: 'EAABwzLixnjYBO987654321...',
      instagram_business_account: {
        id: '17841400000000000',
        name: 'Test Instagram Account',
        username: 'test_instagram',
        profile_picture_url: 'https://example.com/profile.jpg'
      }
    }
  ],
  instagramAccounts: [
    {
      instagramId: '17841400000000000',
      username: 'test_instagram',
      name: 'Test Instagram Account',
      pageId: '987654321',
      pageName: 'Test Business Page',
      pageAccessToken: 'EAABwzLixnjYBO987654321...'
    }
  ],
  timestamp: new Date().toISOString()
};

async function testInstagramOAuthStart() {
  console.log('\n🧪 Тестируем запуск Instagram OAuth flow...');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/instagram/auth/start`, {
      appId: testData.appId,
      appSecret: testData.appSecret,
      redirectUri: testData.redirectUri,
      webhookUrl: testData.webhookUrl,
      instagramId: testData.instagramId,
      campaignId: testData.campaignId
    });

    console.log('✅ OAuth start успешен:', {
      authUrl: response.data.authUrl?.substring(0, 100) + '...',
      state: response.data.state
    });

    return response.data.state;
  } catch (error) {
    console.error('❌ Ошибка OAuth start:', error.response?.data || error.message);
    return null;
  }
}

async function testN8NWebhook() {
  console.log('\n🧪 Тестируем N8N webhook обработку...');
  
  try {
    const response = await axios.post(`${N8N_URL}/webhook/instagram-auth`, mockOAuthData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('✅ N8N webhook успешен:', {
      status: response.status,
      data: response.data
    });

    return true;
  } catch (error) {
    console.error('❌ Ошибка N8N webhook:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return false;
  }
}

async function testInstagramOAuthCallback(state) {
  console.log('\n🧪 Тестируем Instagram OAuth callback...');
  
  if (!state) {
    console.log('⚠️ Пропускаем callback тест - нет state от OAuth start');
    return;
  }

  const mockCode = 'AQBvMz12345abcdef...';
  
  try {
    const response = await axios.get(`${BASE_URL}/api/instagram/auth/callback`, {
      params: {
        code: mockCode,
        state: state
      }
    });

    console.log('✅ OAuth callback успешен:', {
      success: response.data.success,
      message: response.data.message,
      accounts: response.data.data?.instagramAccounts?.length || 0
    });

    return true;
  } catch (error) {
    console.error('❌ Ошибка OAuth callback:', error.response?.data || error.message);
    return false;
  }
}

async function testOAuthStatusCheck(state) {
  console.log('\n🧪 Тестируем проверку статуса OAuth сессии...');
  
  if (!state) {
    console.log('⚠️ Пропускаем status тест - нет state');
    return;
  }

  try {
    const response = await axios.get(`${BASE_URL}/api/instagram/auth/status/${state}`);

    console.log('✅ OAuth status успешен:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Ошибка OAuth status:', error.response?.data || error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Запуск тестов Instagram OAuth системы...');
  console.log('=' .repeat(50));

  // Тест 1: Запуск OAuth flow
  const state = await testInstagramOAuthStart();
  
  // Тест 2: Проверка статуса сессии
  if (state) {
    await testOAuthStatusCheck(state);
  }

  // Тест 3: N8N webhook обработка
  await testN8NWebhook();

  // Тест 4: OAuth callback (с mock данными)
  // await testInstagramOAuthCallback(state);

  console.log('\n' + '=' .repeat(50));
  console.log('🏁 Все тесты завершены!');
  console.log('\n📋 Следующие шаги для полной настройки:');
  console.log('1. Импортируйте workflow: scripts/instagram/instagram-oauth-workflow.json');
  console.log('2. Настройте Directus credentials в N8N');
  console.log('3. Создайте таблицу instagram_oauth_tokens в Directus');
  console.log('4. Протестируйте полный OAuth flow через UI');
}

// Запускаем тесты
runAllTests().catch(console.error);