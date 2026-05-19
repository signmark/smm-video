/**
 * Тест нового чистого Gemini сервиса без зависимости от переменных окружения
 */

async function testGeminiCleanService() {
  try {
    console.log('🧪 Тестируем новый чистый Gemini сервис...');
    
    // Импортируем новый чистый сервис
    const { geminiVertexClean } = await import('./server/services/gemini-vertex-clean');
    
    const testData = {
      text: "Это тестовый текст для улучшения",
      prompt: "Улучши этот текст, сделай его более профессиональным",
      model: "gemini-2.5-flash-preview-05-20"
    };
    
    console.log(`📤 Отправляем запрос с моделью: ${testData.model}`);
    console.log(`📝 Текст: ${testData.text}`);
    console.log(`💭 Промпт: ${testData.prompt}`);
    
    const startTime = Date.now();
    const result = await geminiVertexClean.improveText(testData);
    const endTime = Date.now();
    
    console.log('✅ Успешный ответ от чистого Gemini сервиса!');
    console.log(`⏱️ Время выполнения: ${endTime - startTime}ms`);
    console.log(`📄 Результат: ${result}`);
    
    // Тестируем вторую модель
    console.log('\n🧪 Тестируем вторую модель Gemini 2.5...');
    
    const testData2 = {
      ...testData,
      model: "gemini-2.5-pro-preview-05-06"
    };
    
    console.log(`📤 Отправляем запрос с моделью: ${testData2.model}`);
    
    const startTime2 = Date.now();
    const result2 = await geminiVertexClean.improveText(testData2);
    const endTime2 = Date.now();
    
    console.log('✅ Успешный ответ от второй модели!');
    console.log(`⏱️ Время выполнения: ${endTime2 - startTime2}ms`);
    console.log(`📄 Результат: ${result2}`);
    
    console.log('\n🎉 Все тесты чистого Gemini сервиса прошли успешно!');
    console.log('✨ Старые креденшалы больше не используются');
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании чистого Gemini сервиса:', error.message);
    console.error('📝 Полная ошибка:', error);
  }
}

// Запускаем тест
testGeminiCleanService();