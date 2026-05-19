/**
 * Быстрый тест производительности анализа сайта
 */

import axios from 'axios';

async function testSiteAnalysis() {
  console.log('🚀 Запуск теста производительности анализа сайта...');
  const startTime = Date.now();
  
  try {
    // Тестируем простой URL для проверки производительности с DIRECTUS_TOKEN
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: 'https://example.com'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      },
      timeout: 15000
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Анализ завершён успешно за ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`📊 Размер ответа: ${JSON.stringify(response.data).length} символов`);
    
    if (duration > 10000) {
      console.log('⚠️  ВНИМАНИЕ: Анализ занял больше 10 секунд - возможны проблемы с производительностью');
    } else if (duration < 5000) {
      console.log('🎉 Отличная производительность! Анализ завершился быстро');
    }
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error(`❌ Ошибка анализа за ${duration}ms:`, error.response?.data || error.message);
    
    if (error.code === 'ECONNABORTED') {
      console.log('🔥 КРИТИЧЕСКАЯ ПРОБЛЕМА: Таймаут запроса - сервер подвис!');
    }
  }
}

// Запускаем тест
testSiteAnalysis();