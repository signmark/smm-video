// Тестирование серверного анализа тональности через API
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5000';

console.log('🔍 Тестирование API анализа тональности...');

async function testSentimentAPI() {
    try {
        const testComments = [
            "Отличный продукт! Очень доволен покупкой!",
            "Плохое качество, не рекомендую",
            "Нормальный товар, ничего особенного"
        ];
        
        console.log('📤 Отправляем комментарии для анализа:', testComments);
        
        const response = await fetch(`${API_BASE}/api/analyze-sentiment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                comments: testComments
            })
        });
        
        console.log('📥 Статус ответа:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Анализ тональности выполнен успешно!');
            console.log('📊 Результат:', JSON.stringify(result, null, 2));
        } else {
            const errorText = await response.text();
            console.log('❌ Ошибка API:', errorText);
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
    }
}

// Запускаем тест
testSentimentAPI();