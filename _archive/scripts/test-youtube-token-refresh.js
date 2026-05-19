/**
 * Тест YouTube token refresh через N8N webhook
 */

const N8N_URL = 'https://n8n.nplanner.ru';

async function testYouTubeTokenRefresh() {
  console.log('=== ТЕСТ YOUTUBE TOKEN REFRESH ===\n');

  try {
    console.log('📞 Отправляем запрос на manual token refresh...');
    
    const response = await fetch(`${N8N_URL}/webhook/youtube-refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        campaignId: 'test-campaign',
        force: true
      })
    });

    console.log(`📊 Статус ответа: ${response.status}`);
    
    if (response.ok) {
      const result = await response.text();
      console.log('✅ Ответ N8N webhook:');
      console.log(result);
    } else {
      console.log('❌ Ошибка N8N webhook:');
      const error = await response.text();
      console.log(error);
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
  }
}

// Запускаем тест
testYouTubeTokenRefresh();