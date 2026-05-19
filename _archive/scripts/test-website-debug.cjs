const axios = require('axios');

async function testWebsiteAnalysis() {
  console.log('🔧 Тестирование анализа сайта...');
  
  try {
    const response = await axios.post('http://0.0.0.0:5000/api/website-analysis', {
      url: 'https://example.com',
      campaignId: 'test-campaign-id'
    }, {
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('✅ Ответ получен:', response.status);
    console.log('📊 Данные:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

testWebsiteAnalysis();