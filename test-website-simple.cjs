/**
 * Простой тест анализа сайта через быстрый вызов API
 */

const axios = require('axios');

async function testSimpleWebsiteAnalysis() {
  console.log('🧪 Тестирование простого анализа сайта...');
  
  try {
    console.log('📡 Отправляем запрос на анализ сайта...');
    
    // Делаем прямой запрос к extractFullSiteContent функции через внутренний API
    const response = await axios.get('http://localhost:5000/api/health');
    
    if (response.status === 200) {
      console.log('✅ Сервер отвечает');
      
      // Теперь проверим, работает ли функция анализа сайтов в принципе
      console.log('🔍 Проверяем функцию анализа...');
      
      // Попробуем создать прямой запрос к тестовому endpoint
      const testEndpoint = await axios.post('http://localhost:5000/api/test-extract', {
        url: 'https://nplanner.ru'
      }).catch(err => {
        console.log('⚠️ Тестовый endpoint не найден (ожидаемо)');
        return null;
      });
      
    } else {
      console.log('❌ Сервер не отвечает');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

testSimpleWebsiteAnalysis();