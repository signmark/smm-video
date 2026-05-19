/**
 * Прямой тест Gemini 2.5 с обновленными креденшалами
 */

async function testGemini25Direct() {
  try {
    console.log('=== Тест Gemini 2.5 с новыми креденшалами ===');
    
    // Читаем правильный Service Account напрямую из файла
    const fs = await import('fs');
    const path = await import('path');
    
    const serviceAccountPath = path.default.join(process.cwd(), 'attached_assets', 'laboratory-449308-e59e916c28da.json');
    const serviceAccountData = fs.default.readFileSync(serviceAccountPath, 'utf8');
    const credentials = JSON.parse(serviceAccountData);
    
    console.log('✅ Project ID из файла:', credentials.project_id);
    console.log('✅ Client email из файла:', credentials.client_email);
    
    // Принудительно устанавливаем правильные креденшалы
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = serviceAccountData;
    
    // Импортируем сервис
    const { vertexAIAuth } = await import('./server/services/vertex-ai-auth.js');
    
    // Получаем токен
    console.log('\nПолучаем access token...');
    const accessToken = await vertexAIAuth.getAccessToken();
    console.log('✅ Access token получен:', accessToken.substring(0, 50) + '...');
    
    // Тестируем Gemini 2.5 Flash
    console.log('\nТестируем Gemini 2.5 Flash...');
    const model = 'gemini-2.5-flash-preview-0520';
    const projectId = credentials.project_id;
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
    
    console.log('URL:', url);
    
    const requestData = {
      contents: [
        {
          parts: [
            {
              text: "Привет! Это тест Gemini 2.5. Ответь кратко."
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100
      }
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    console.log('Статус ответа:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Gemini 2.5 Flash работает!');
      console.log('Ответ:', result.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет текста в ответе');
    } else {
      const error = await response.text();
      console.log('❌ Ошибка Gemini 2.5 Flash:', error);
    }
    
    // Тестируем Gemini 2.5 Pro
    console.log('\nТестируем Gemini 2.5 Pro...');
    const proModel = 'gemini-2.5-pro-preview-0506';
    const proUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${proModel}:generateContent`;
    
    const proResponse = await fetch(proUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    console.log('Статус ответа Pro:', proResponse.status);
    
    if (proResponse.ok) {
      const proResult = await proResponse.json();
      console.log('✅ Gemini 2.5 Pro работает!');
      console.log('Ответ:', proResult.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет текста в ответе');
    } else {
      const proError = await proResponse.text();
      console.log('❌ Ошибка Gemini 2.5 Pro:', proError);
    }
    
  } catch (error) {
    console.log('❌ Общая ошибка:', error.message);
  }
}

testGemini25Direct();