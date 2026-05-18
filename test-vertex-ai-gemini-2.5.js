/**
 * Тестовый скрипт для проверки работы Gemini 2.5 через Vertex AI
 */

async function testVertexAIGemini25() {
  try {
    console.log('🧪 Тестирование Vertex AI Gemini 2.5 моделей');
    
    // Импортируем необходимые сервисы
    const { vertexAICredentials } = await import('./server/services/vertex-ai-credentials.js');
    const { createVertexAIService } = await import('./server/services/vertex-ai.js');
    
    // Проверяем наличие учетных данных
    if (!vertexAICredentials.hasCredentials()) {
      console.log('❌ Учетные данные Vertex AI не найдены');
      return;
    }
    
    console.log('✅ Учетные данные Vertex AI найдены');
    
    const credentials = vertexAICredentials.loadCredentials();
    const projectId = vertexAICredentials.getProjectId();
    
    console.log('📋 Project ID:', projectId);
    console.log('📧 Service Account:', credentials.client_email);
    
    // Создаем сервис Vertex AI
    const vertexAIService = createVertexAIService(projectId, credentials);
    
    // Тестируем подключение
    console.log('\n🔗 Тестируем подключение к Vertex AI...');
    const connectionTest = await vertexAIService.testConnection();
    
    if (connectionTest) {
      console.log('✅ Подключение к Vertex AI успешно');
    } else {
      console.log('❌ Ошибка подключения к Vertex AI');
      return;
    }
    
    // Получаем список доступных моделей
    console.log('\n📋 Доступные модели Gemini 2.5:');
    const availableModels = vertexAIService.getAvailableModels();
    availableModels.forEach(model => {
      console.log(`  - ${model}`);
    });
    
    // Тестируем генерацию с моделью 2.5 Flash
    console.log('\n🚀 Тестируем генерацию с Gemini 2.5 Flash...');
    const flashResult = await vertexAIService.generateText({
      prompt: 'Напиши короткий пост для социальных сетей о пользе здорового питания.',
      model: 'gemini-2.5-flash',
      maxTokens: 200,
      temperature: 0.7
    });
    
    console.log('📝 Результат Gemini 2.5 Flash:');
    console.log(flashResult);
    
    // Тестируем генерацию с моделью 2.5 Pro
    console.log('\n🚀 Тестируем генерацию с Gemini 2.5 Pro...');
    const proResult = await vertexAIService.generateText({
      prompt: 'Создай развернутый пост о важности физической активности, включи научные факты.',
      model: 'gemini-2.5-pro',
      maxTokens: 400,
      temperature: 0.6
    });
    
    console.log('📝 Результат Gemini 2.5 Pro:');
    console.log(proResult);
    
    console.log('\n✅ Все тесты Vertex AI Gemini 2.5 успешно завершены!');
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании Vertex AI:', error);
    console.error('Детали ошибки:', error.message);
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', error.response.data);
    }
  }
}

// Запускаем тест
if (import.meta.url === `file://${process.argv[1]}`) {
  testVertexAIGemini25();
}

export { testVertexAIGemini25 };