import fetch from 'node-fetch';
import { vertexAIAuth } from './services/vertex-ai-auth.js';

console.log('🔍 Тестирование Vertex AI для анализа тональности...');

async function testSentimentAnalysis() {
    try {
        console.log('🔑 Получаем access token для Vertex AI...');
        const accessToken = await vertexAIAuth.getAccessToken();
        
        if (!accessToken) {
            throw new Error('Не удалось получить access token');
        }
        
        console.log('✅ Access token получен успешно!');
        console.log(`🔑 Токен: ${accessToken.substring(0, 50)}...`);
        
        const url = vertexAIAuth.getVertexAIUrl('gemini-2.5-flash');
        
        // Тестовые комментарии для анализа тональности
        const testComments = [
            "Отличный продукт! Очень доволен покупкой!",
            "Плохое качество, не рекомендую",
            "Нормальный товар, ничего особенного"
        ];
        
        const prompt = `Проанализируй тональность следующих комментариев и верни результат в JSON формате:
        
Комментарии:
${testComments.map((comment, i) => `${i+1}. ${comment}`).join('\n')}

Формат ответа (только JSON, без дополнительного текста):
{
  "analysis": [
    {
      "comment": "текст комментария",
      "sentiment": "positive|negative|neutral",
      "confidence": 0.95,
      "keywords": ["ключевое", "слово"]
    }
  ]
}`;

        const requestData = {
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 2048  // Уменьшенный лимит для избежания MAX_TOKENS
            }
        };
        
        console.log('📤 Отправляем запрос на анализ тональности...');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        console.log('📥 Ответ от Vertex AI:', response.status);
        
        if (response.ok) {
            console.log('🎉 Vertex AI успешно проанализировал тональность!');
            
            if (result.candidates && result.candidates.length > 0) {
                const candidate = result.candidates[0];
                
                // Проверяем на проблемы с генерацией
                if (candidate.finishReason === 'MAX_TOKENS') {
                    console.log('⚠️ Vertex AI достиг лимита токенов');
                    console.log('📊 Метрики использования:', result.usageMetadata);
                } else if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    const generatedText = candidate.content.parts[0].text;
                    console.log('📄 Анализ тональности:');
                    console.log(generatedText);
                    
                    // Попробуем распарсить JSON
                    try {
                        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const analysis = JSON.parse(jsonMatch[0]);
                            console.log('✅ JSON успешно распарсен:');
                            console.log(JSON.stringify(analysis, null, 2));
                        }
                    } catch (parseError) {
                        console.log('⚠️ Не удалось распарсить JSON, но текст получен');
                    }
                } else {
                    console.log('⚠️ Нет контента в ответе, но статус 200');
                    console.log('📊 Полный ответ:', JSON.stringify(result, null, 2));
                }
            } else {
                console.log('⚠️ Нет candidates в ответе');
                console.log('📊 Полный ответ:', JSON.stringify(result, null, 2));
            }
        } else {
            console.log('❌ Ошибка Vertex AI:', result);
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        console.error('Стек:', error.stack);
    }
}

// Запускаем тест
testSentimentAnalysis();