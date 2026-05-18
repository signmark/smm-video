import { GeminiProxyService } from './services/gemini-proxy-fixed.js';

console.log('🔍 Тестирование исправленного Vertex AI сервиса...');

// Создаем экземпляр сервиса
const geminiService = new GeminiProxyService({
    apiKey: process.env.GEMINI_API_KEY
});

async function testVertexAI() {
    try {
        console.log('🧪 Тестируем generateText с Vertex AI...');
        
        const result = await geminiService.generateText({
            prompt: "Напиши короткий текст про здоровое питание",
            model: "gemini-2.5-flash"
        });
        
        console.log('✅ Vertex AI успешно сгенерировал текст:');
        console.log(result);
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании Vertex AI:', error.message);
        console.error('Стек:', error.stack);
    }
}

// Запускаем тест
testVertexAI();