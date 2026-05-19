/**
 * Прямой тест Vertex AI API для диагностики
 */

async function testVertexAIDirect() {
  try {
    console.log('=== Прямой тест Vertex AI API ===');
    
    // Импортируем auth сервис
    const { vertexAIAuth } = await import('./server/services/vertex-ai-auth.js');
    
    // Получаем токен
    console.log('Получаем access token...');
    const accessToken = await vertexAIAuth.getAccessToken();
    console.log('✅ Access token получен:', accessToken.substring(0, 50) + '...');
    
    // Получаем project ID
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY не настроен');
    }
    
    console.log('Service Account Key:', serviceAccountKey.substring(0, 100) + '...');
    
    let credentials;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch (parseError) {
      console.log('❌ Ошибка парсинга Service Account Key:', parseError.message);
      console.log('Содержимое ключа:', serviceAccountKey);
      throw parseError;
    }
    
    const projectId = credentials.project_id;
    console.log('✅ Project ID:', projectId);
    
    // Тестируем список моделей
    console.log('\n1. Тестируем список доступных моделей...');
    const listUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models`;
    
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const listText = await listResponse.text();
    console.log(`Статус: ${listResponse.status}`);
    console.log(`Ответ: ${listText.substring(0, 500)}...`);
    
    // Тестируем конкретную модель Gemini 2.5
    console.log('\n2. Тестируем Gemini 2.5 Flash...');
    const model = 'gemini-2.5-flash-preview-0520';
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
    
    const requestData = {
      contents: [
        {
          parts: [
            {
              text: 'Привет! Это тест Gemini 2.5'
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100
      }
    };
    
    console.log(`URL: ${url}`);
    console.log(`Данные запроса: ${JSON.stringify(requestData, null, 2)}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestData)
    });
    
    const responseText = await response.text();
    console.log(`\nСтатус ответа: ${response.status}`);
    console.log(`Заголовки: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);
    console.log(`Тело ответа: ${responseText}`);
    
    if (response.ok) {
      try {
        const responseData = JSON.parse(responseText);
        console.log('✅ JSON парсинг успешен');
        console.log('Структура ответа:', JSON.stringify(responseData, null, 2));
      } catch (parseError) {
        console.log('❌ Ошибка парсинга JSON:', parseError.message);
      }
    } else {
      console.log('❌ HTTP ошибка');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testVertexAIDirect();