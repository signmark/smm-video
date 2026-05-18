/**
 * Прямой тест YouTube token refresh с правильными credentials
 * Обходим N8N и тестируем напрямую с Google OAuth API
 */

const YOUTUBE_CLIENT_ID = '267968960436-f1fcdat2q3hrn029ine955v5d3t71b2k.apps.googleusercontent.com';
const YOUTUBE_CLIENT_SECRET = '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';

// Тестовый refresh_token (нужен реальный токен для полного теста)
const TEST_REFRESH_TOKEN = 'your_real_refresh_token_here';

async function testYouTubeTokenRefreshDirect() {
  console.log('=== ПРЯМОЙ ТЕСТ YOUTUBE TOKEN REFRESH ===\n');

  try {
    console.log('📋 Используемые credentials:');
    console.log(`   Client ID: ${YOUTUBE_CLIENT_ID}`);
    console.log(`   Client Secret: ${YOUTUBE_CLIENT_SECRET}`);
    console.log(`   Refresh Token: ${TEST_REFRESH_TOKEN}`);

    console.log('\n🧪 Отправляем запрос к Google OAuth API...');
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: TEST_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });

    const result = await response.json();
    
    console.log(`📊 Статус ответа: ${response.status}`);
    console.log('📄 Ответ Google OAuth API:');
    console.log(JSON.stringify(result, null, 2));

    if (response.ok && result.access_token) {
      console.log('\n✅ УСПЕХ: Новый access_token получен!');
      console.log(`🔑 Access Token: ${result.access_token.substring(0, 50)}...`);
      console.log(`⏰ Expires in: ${result.expires_in} секунд`);
    } else if (result.error === 'invalid_client') {
      console.log('\n❌ ОШИБКА: invalid_client - credentials неправильные');
    } else if (result.error === 'invalid_grant') {
      console.log('\n⚠️ ОШИБКА: invalid_grant - refresh_token неправильный или истек');
      console.log('💡 Решение: Нужен новый refresh_token через OAuth flow');
    } else {
      console.log('\n❓ Неожиданная ошибка от Google OAuth API');
    }

  } catch (error) {
    console.error('\n❌ Ошибка при тестировании:', error.message);
  }
}

// Для автоматического теста с credentials validation
async function validateCredentialsOnly() {
  console.log('\n=== ВАЛИДАЦИЯ CREDENTIALS (БЕЗ REFRESH_TOKEN) ===\n');

  try {
    // Тестируем с заведомо неправильным refresh_token для проверки credentials
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: 'invalid_test_token',
        grant_type: 'refresh_token'
      })
    });

    const result = await response.json();
    
    if (result.error === 'invalid_client') {
      console.log('❌ CREDENTIALS НЕПРАВИЛЬНЫЕ (invalid_client)');
      return false;
    } else if (result.error === 'invalid_grant') {
      console.log('✅ CREDENTIALS ПРАВИЛЬНЫЕ (invalid_grant для неправильного refresh_token)');
      return true;
    } else {
      console.log('❓ Неожиданный ответ:', result);
      return false;
    }

  } catch (error) {
    console.error('❌ Ошибка при валидации:', error.message);
    return false;
  }
}

// Запускаем валидацию
console.log('🚀 Запуск валидации YouTube credentials...\n');
validateCredentialsOnly().then(isValid => {
  if (isValid) {
    console.log('\n🎉 ЗАКЛЮЧЕНИЕ: YouTube credentials РАБОТАЮТ ПРАВИЛЬНО');
    console.log('💡 Проблема invalid_client в N8N связана с:');
    console.log('   1. N8N использует другую базу данных (продакшен)');
    console.log('   2. N8N кэширует старые credentials');
    console.log('   3. N8N workflow не обновлен с новой структурой данных');
  } else {
    console.log('\n❌ ЗАКЛЮЧЕНИЕ: Проблема в credentials');
  }
});

// Для ручного теста раскомментируйте:
// testYouTubeTokenRefreshDirect();