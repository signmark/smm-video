/**
 * Простой тест анализа сайта с использованием переменной окружения
 */

import axios from 'axios';

async function testSingleWebsite() {
  console.log('🧪 Тестирование анализа сайта...\n');
  
  const testUrl = 'https://example.com';
  
  try {
    console.log(`📍 Анализируем: ${testUrl}`);
    
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: testUrl
    }, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN || 'test-token'}`
      }
    });

    if (response.data.success) {
      const data = response.data.data;
      console.log(`✅ Анализ успешен`);
      console.log(`📊 Название: ${data.companyName}`);
      console.log(`🏢 Описание: ${data.businessDescription}`);
      console.log(`💎 Ценности: ${data.businessValues}`);
      console.log(`🔮 Философия: ${data.productBeliefs}`);
    } else {
      console.log(`❌ Ошибка: ${response.data.error}`);
    }
    
  } catch (error) {
    console.log(`💥 Ошибка: ${error.message}`);
    if (error.response?.data) {
      console.log(`📋 Детали: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

testSingleWebsite().catch(console.error);