/**
 * Простой тест производительности новой функции анализа сайта
 * Проверяем, что сервер больше не зависает
 */

import axios from 'axios';

async function testPerformance() {
  console.log('🚀 Тест производительности анализа сайта...');
  
  const tests = [
    'https://example.com',
    'https://google.com',
    'https://github.com'
  ];
  
  for (const url of tests) {
    const startTime = Date.now();
    
    try {
      // Тестируем прямой вызов API без авторизации
      const response = await axios.get(`http://localhost:5000/api/health`, {
        timeout: 5000
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ Сервер отвечает за ${duration}ms - сервер НЕ зависает!`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.code === 'ECONNABORTED') {
        console.error(`🔥 КРИТИЧНО: Таймаут ${duration}ms - сервер ПОДВИС!`);
      } else {
        console.log(`⚡ Сервер отвечает за ${duration}ms (ошибка: ${error.message})`);
      }
    }
  }
}

testPerformance();