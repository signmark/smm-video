/**
 * Тест Gemini 2.5 с правильными названиями моделей
 */

async function testGemini25CorrectNames() {
  try {
    console.log('=== Тест Gemini 2.5 с правильными названиями ===');
    
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
    
    // Правильные названия моделей Gemini 2.5
    const modelsToTest = [
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.5-pro-preview-05-06'
    ];
    
    const projectId = credentials.project_id;
    console.log(`\nТестируем модели в проекте: ${projectId}`);
    
    for (const model of modelsToTest) {
      console.log(`\n--- Тестируем ${model} ---`);
      
      const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
      
      // Правильный формат для Gemini 2.5
      const requestData = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Улучши этот текст: Привет! Это тест Gemini 2.5. Ответь кратко."
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 150
        }
      };
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });
        
        console.log(`Статус: ${response.status}`);
        
        if (response.ok) {
          const result = await response.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа';
          console.log(`✅ ${model} РАБОТАЕТ!`);
          console.log(`Улучшенный текст: "${text.trim()}"`);
        } else {
          const error = await response.text();
          const errorObj = JSON.parse(error);
          console.log(`❌ ${model}: ${errorObj.error.code} - ${errorObj.error.message}`);
        }
      } catch (error) {
        console.log(`❌ ${model}: Ошибка запроса - ${error.message}`);
      }
    }
    
  } catch (error) {
    console.log('❌ Общая ошибка:', error.message);
  }
}

testGemini25CorrectNames();