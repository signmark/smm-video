/**
 * Тест комплексной системы улучшения текста со всеми AI сервисами
 */

async function testTextEnhancement() {
  try {
    console.log('=== Тест системы улучшения текста ===');
    
    const testText = 'Программа для питания хорошая';
    const testPrompt = 'Улучши этот текст, сделай его более профессиональным и информативным';
    
    // Тестируем все доступные AI сервисы
    const services = [
      { name: 'Claude', endpoint: '/api/claude/improve-text' },
      { name: 'Gemini 2.5 Flash', endpoint: '/api/gemini/improve-text', model: 'gemini-2.5-flash-preview-0520' },
      { name: 'Gemini 2.5 Pro', endpoint: '/api/gemini/improve-text', model: 'gemini-2.5-pro-preview-0506' },
      { name: 'DeepSeek', endpoint: '/api/deepseek/improve-text' },
      { name: 'Qwen', endpoint: '/api/qwen/improve-text' }
    ];
    
    for (const service of services) {
      console.log(`\n--- Тестирование ${service.name} ---`);
      
      const requestData = {
        text: testText,
        prompt: testPrompt
      };
      
      if (service.model) {
        requestData.model = service.model;
      }
      
      try {
        const response = await fetch(`http://localhost:5000${service.endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`✅ ${service.name} успешно:`);
          console.log(`Результат: ${result.improvedText?.substring(0, 100)}...`);
        } else {
          const errorText = await response.text();
          console.log(`❌ ${service.name} ошибка (${response.status}): ${errorText}`);
        }
      } catch (error) {
        console.log(`❌ ${service.name} недоступен: ${error.message}`);
      }
    }
    
    console.log('\n=== Тест завершен ===');
    
  } catch (error) {
    console.error('Ошибка при тестировании:', error.message);
  }
}

testTextEnhancement();