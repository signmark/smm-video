/**
 * Тест умного fallback с разными типами сайтов
 */

import axios from 'axios';

const testUrls = [
  'https://shop.gaming.com',
  'https://tech-services.com', 
  'https://news-blog.ru',
  'https://software-company.tech'
];

async function testSmartFallback(url) {
  console.log(`🧪 Тестируем: ${url}`);
  
  try {
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: url,
      campaignId: '8e4a1018-72ff-48eb-a3ff-9bd41bf83253'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      },
      timeout: 30000
    });

    if (response.data.success) {
      console.log(`✅ ${url}:`);
      console.log(`   Компания: "${response.data.data.companyName}"`);
      console.log(`   Описание: "${response.data.data.businessDescription.substring(0,60)}..."`);
      console.log(`   Ценности: "${response.data.data.businessValues}"`);
      console.log(`   Философия: "${response.data.data.productBeliefs.substring(0,50)}..."`);
      console.log('');
    } else {
      console.log(`❌ ${url}: ${response.data.error}`);
    }
  } catch (error) {
    console.log(`❌ ${url}: ${error.message}`);
  }
}

async function runAllTests() {
  console.log('🚀 Запуск тестов умного fallback...\n');
  
  for (const url of testUrls) {
    await testSmartFallback(url);
    await new Promise(resolve => setTimeout(resolve, 2000)); // пауза между тестами
  }
  
  console.log('✅ Тесты завершены');
}

runAllTests();