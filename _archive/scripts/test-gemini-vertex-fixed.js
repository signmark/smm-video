/**
 * Тест исправленного Gemini Vertex сервиса с реальным Vertex AI
 */

async function testGeminiVertexService() {
  try {
    console.log('=== Тест Gemini Vertex сервиса с настоящим Vertex AI ===');
    
    const { geminiVertexService } = await import('./server/services/gemini-vertex.js');
    
    console.log('1. Тестирование улучшения текста через Vertex AI (модель 2.5)...');
    
    const testText = 'Программа для питания хорошая';
    const testPrompt = 'Улучши этот текст, сделай его более профессиональным и информативным';
    
    const improvedText = await geminiVertexService.improveText({
      text: testText,
      prompt: testPrompt,
      model: 'gemini-2.5-flash-preview-0520' // Должен идти на Vertex AI
    });
    
    console.log('✅ Исходный текст:', testText);
    console.log('✅ Улучшенный текст через Vertex AI:', improvedText);
    
    console.log('\n2. Тестирование генерации текста через Vertex AI (модель 2.5)...');
    
    const generatedText = await geminiVertexService.generateText({
      prompt: 'Напиши короткое описание преимуществ программы для нутрициологов',
      model: 'gemini-2.5-pro-preview-0506' // Должен идти на Vertex AI
    });
    
    console.log('✅ Сгенерированный текст через Vertex AI:', generatedText);
    
    console.log('\n3. Тестирование с обычной моделью (должен использовать стандартный API)...');
    
    const standardText = await geminiVertexService.generateText({
      prompt: 'Простой тест для обычной модели',
      model: 'gemini-1.5-flash' // Должен идти на стандартный API
    });
    
    console.log('✅ Текст через стандартный API:', standardText);
    
    console.log('\n✅ Все тесты пройдены успешно! Vertex AI работает корректно.');
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
    
    if (error.message.includes('Vertex AI недоступен')) {
      console.log('\n🔧 Для использования Gemini 2.5 моделей необходимо:');
      console.log('1. Активировать Vertex AI API в Google Cloud Console');
      console.log('2. Убедиться в правильности Service Account ключа');
      console.log('3. Проверить права доступа к Vertex AI');
    }
  }
}

// Запускаем тест
testGeminiVertexService();