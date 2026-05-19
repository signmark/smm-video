/**
 * Тест Gemini 2.0 Flash с правильным форматом
 */

async function testGemini2Flash() {
  try {
    console.log('=== Тест Gemini 2.0 Flash ===');
    
    // Читаем правильный Service Account
    const fs = await import('fs');
    const path = await import('path');
    
    const serviceAccountPath = path.default.join(process.cwd(), 'attached_assets', 'laboratory-449308-e59e916c28da.json');
    const serviceAccountData = fs.default.readFileSync(serviceAccountPath, 'utf8');
    const credentials = JSON.parse(serviceAccountData);
    
    // Устанавливаем креденшалы
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = serviceAccountData;
    
    // Получаем токен
    const { vertexAIAuth } = await import('./server/services/vertex-ai-auth.js');
    const accessToken = await vertexAIAuth.getAccessToken();
    
    console.log('✅ Access token получен');
    
    const model = 'gemini-2.0-flash-exp';
    const projectId = credentials.project_id;
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
    
    // Правильный формат для Gemini 2.0
    const requestData = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Улучши этот текст: Привет, как дела? Хорошо ли ты работаешь?"
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 200
      }
    };
    
    console.log('\nТестируем Gemini 2.0 Flash...');
    console.log('URL:', url);
    
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
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа';
      console.log('✅ Gemini 2.0 Flash РАБОТАЕТ!');
      console.log('Улучшенный текст:', text);
    } else {
      const error = await response.text();
      console.log('❌ Ошибка:', error);
    }
    
  } catch (error) {
    console.log('❌ Общая ошибка:', error.message);
  }
}

testGemini2Flash();