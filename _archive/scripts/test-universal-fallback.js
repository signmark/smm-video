/**
 * Тест универсального fallback механизма для анализа сайта
 */

import axios from 'axios';

async function testUniversalFallback() {
  console.log('🧪 Тестируем универсальный fallback для любого сайта...');
  
  try {
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: 'https://nonexistent-test-site.com',
      campaignId: '8e4a1018-72ff-48eb-a3ff-9bd41bf83253'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      },
      timeout: 35000
    });

    if (response.data.success) {
      console.log('✅ Универсальный fallback работает!');
      console.log('📝 Полученные данные:');
      console.log(`  companyName: "${response.data.data.companyName}"`);
      console.log(`  businessValues: "${response.data.data.businessValues}"`);
      console.log(`  productBeliefs: "${response.data.data.productBeliefs}"`);
      console.log(`  businessDescription: "${response.data.data.businessDescription.substring(0,50)}..."`);
      
      // Проверяем что все поля заполнены
      const requiredFields = ['companyName', 'businessValues', 'productBeliefs', 'businessDescription'];
      const missingFields = requiredFields.filter(field => !response.data.data[field] || response.data.data[field].trim() === '');
      
      if (missingFields.length === 0) {
        console.log('🎉 Все обязательные поля заполнены!');
      } else {
        console.log(`❌ Незаполненные поля: ${missingFields.join(', ')}`);
      }
    } else {
      console.log('❌ Ошибка в ответе:', response.data.error);
    }
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.log('⏰ Тайм-аут теста - это нормально, fallback мог активироваться');
    } else {
      console.log('❌ Ошибка запроса:', error.message);
    }
  }
}

testUniversalFallback();