/**
 * Тест API анализа сайта для заполнения бизнес-анкеты
 */

const axios = require('axios');
const crypto = require('crypto');

const SERVER_URL = 'http://localhost:5000';

// Используем тестовый токен из переменных окружения
const TEST_TOKEN = process.env.DIRECTUS_TOKEN;

async function testWebsiteAnalysisAPI() {
  console.log('🧪 Тестирование API анализа сайта...');
  
  if (!TEST_TOKEN) {
    console.error('❌ DIRECTUS_TOKEN не найден в переменных окружения');
    return;
  }
  
  try {
    const startTime = Date.now();
    
    const testData = {
      url: 'https://nplanner.ru',
      campaignId: 'test-campaign-' + crypto.randomUUID()
    };
    
    console.log(`📡 Отправляем запрос на анализ: ${testData.url}`);
    
    const response = await axios.post(`${SERVER_URL}/api/website-analysis`, testData, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 секунд таймаут
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ API ответил за ${duration}ms`);
    console.log('📊 Статус ответа:', response.status);
    console.log('📊 Данные ответа:', JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.data) {
      const data = response.data.data;
      console.log('\n🔍 Анализ полученных данных:');
      console.log('- companyName:', data.companyName ? 'ЗАПОЛНЕНО' : 'ПУСТО');
      console.log('- businessDescription:', data.businessDescription ? 'ЗАПОЛНЕНО' : 'ПУСТО');
      console.log('- productsServices:', data.productsServices ? 'ЗАПОЛНЕНО' : 'ПУСТО');
      console.log('- targetAudience:', data.targetAudience ? 'ЗАПОЛНЕНО' : 'ПУСТО');
      
      const filledFields = Object.keys(data).filter(key => data[key] && data[key].length > 0);
      console.log(`\n📈 Заполнено полей: ${filledFields.length} из ${Object.keys(data).length}`);
      console.log('📋 Заполненные поля:', filledFields);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании API:', error.message);
    if (error.response) {
      console.error('📛 Статус ошибки:', error.response.status);
      console.error('📛 Данные ошибки:', error.response.data);
    }
  }
}

testWebsiteAnalysisAPI();