/**
 * Тест исправленного Gemini API для анализа сайта
 */

import axios from 'axios';

async function testGeminiFixedAnalysis() {
  console.log('=== ТЕСТ ИСПРАВЛЕННОГО GEMINI API АНАЛИЗА ===');
  
  try {
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: 'https://www.cybersport.ru',
      campaignId: '8e4a1018-72ff-48eb-a3ff-9bd41bf83253'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTc1MTQ0MjIxMiwiZXhwIjoxNzUxNDQzMTEyLCJpc3MiOiJkaXJlY3R1cyJ9.PbzpmRcTRMYj9ofICFsTWtDuhg9Lycb3ECWdHQ8Vkoc'
      },
      timeout: 45000 // 45 секунд (DeepSeek timeout 15s + Gemini 20s + fallback 10s)
    });
    
    console.log('✅ SUCCESS: Анализ сайта выполнен');
    console.log('📊 Статус:', response.status);
    
    const data = response.data.data;
    console.log('\n📋 РЕЗУЛЬТАТ АНАЛИЗА:');
    console.log('- companyName:', data.companyName);
    console.log('- businessDescription:', data.businessDescription);
    console.log('- businessValues:', data.businessValues);
    console.log('- productBeliefs:', data.productBeliefs);
    
    // Проверяем что все поля заполнены
    const allFields = [
      'companyName', 'businessDescription', 'businessValues', 
      'productBeliefs', 'targetAudience', 'competitiveAdvantages'
    ];
    
    let filledFields = 0;
    allFields.forEach(field => {
      if (data[field] && data[field].trim() !== '') {
        filledFields++;
      }
    });
    
    console.log(`\n🎯 ЗАПОЛНЕНО ПОЛЕЙ: ${filledFields}/${allFields.length}`);
    
    if (data.businessValues && data.productBeliefs) {
      console.log('✅ КРИТИЧЕСКИЕ ПОЛЯ ЗАПОЛНЕНЫ!');
    } else {
      console.log('❌ КРИТИЧЕСКИЕ ПОЛЯ НЕ ЗАПОЛНЕНЫ');
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.response?.data || error.message);
    console.error('❌ CODE:', error.code);
  }
}

testGeminiFixedAnalysis();