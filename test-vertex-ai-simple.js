/**
 * Простой тест для проверки Vertex AI аутентификации и доступа к Gemini 2.5
 */

async function testVertexAIAuth() {
  try {
    console.log('=== Тест Vertex AI аутентификации ===');
    
    // Импортируем сервис аутентификации
    const { vertexAIAuth } = await import('./server/services/vertex-ai-auth.js');
    
    console.log('1. Получение Access Token...');
    const accessToken = await vertexAIAuth.getAccessToken();
    
    if (!accessToken) {
      console.error('❌ Не удалось получить Access Token');
      return;
    }
    
    console.log('✅ Access Token получен:', accessToken.substring(0, 20) + '...');
    console.log('2. Проект ID:', vertexAIAuth.getProjectId());
    console.log('3. Локация:', vertexAIAuth.getLocation());
    
    // Тестируем URL для Gemini 2.5
    const model = 'gemini-2.5-flash-preview-0520';
    const url = vertexAIAuth.getVertexAIUrl(model);
    console.log('4. URL для Vertex AI:', url);
    
    console.log('\n=== Тест простого запроса к Vertex AI ===');
    
    // Простой запрос к Vertex AI
    const requestData = {
      contents: [
        {
          parts: [
            {
              text: "Привет! Как дела?"
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1000
      }
    };
    
    console.log('5. Отправка запроса к Vertex AI...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    console.log('6. Статус ответа:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ошибка:', errorText);
      return;
    }
    
    const responseData = await response.json();
    console.log('✅ Успешный ответ от Vertex AI');
    
    if (responseData.candidates && responseData.candidates.length > 0) {
      const text = responseData.candidates[0].content.parts[0].text;
      console.log('📝 Ответ модели:', text);
    }
    
    console.log('\n✅ Vertex AI работает корректно!');
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании Vertex AI:', error.message);
  }
}

// Запускаем тест
testVertexAIAuth();