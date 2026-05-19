/**
 * Быстрый тест функции "Использовать данные кампании" для остальных AI сервисов
 */

import axios from 'axios';

const CONFIG = {
  baseUrl: 'http://localhost:5000',
  authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTc0ODQ0NzgwNywiZXhwIjoxNzQ4NDQ4NzA3LCJpc3MiOiJkaXJlY3R1cyJ9.4dqTV1zL7jdY03K9L2aCp4djbvwy7lonlU-DPtWShbc',
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
};

async function testService(service) {
  try {
    console.log(`🧪 Тестируем ${service}...`);
    
    const response = await axios.post(`${CONFIG.baseUrl}/api/generate-content`, {
      prompt: 'Напиши короткий пост про наш сервис',
      service: service,
      useCampaignData: true,
      campaignId: CONFIG.campaignId
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.authToken}` },
      timeout: 25000
    });
    
    if (response.data.success) {
      const content = response.data.content;
      const hasRealData = content.toLowerCase().includes('nplanner') || content.toLowerCase().includes('планировщик');
      console.log(`✅ ${service}: ${hasRealData ? 'Данные кампании найдены' : 'Без данных кампании'}`);
      console.log(`📝 Фрагмент: ${content.substring(0, 100)}...`);
      return { success: true, hasRealData };
    } else {
      console.log(`❌ ${service}: ${response.data.error}`);
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    console.log(`❌ ${service}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Финальный тест функции "Использовать данные кампании"\n');
  
  const services = ['gemini', 'deepseek', 'qwen'];
  const results = {};
  
  for (const service of services) {
    console.log(`📋 Тестируем ${service}...`);
    const result = await testService(service);
    results[service] = result;
    console.log('');
    // Короткая пауза между тестами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('📊 ИТОГОВЫЕ РЕЗУЛЬТАТЫ:');
  console.log('========================');
  
  for (const [service, result] of Object.entries(results)) {
    const status = result.success ? (result.hasRealData ? '✅ С данными кампании' : '⚠️ Без данных кампании') : '❌ Ошибка';
    console.log(`${service.toUpperCase()}: ${status}`);
  }
  
  const successCount = Object.values(results).filter(r => r.success && r.hasRealData).length;
  console.log(`\n🎯 Успешно работают с данными кампании: ${successCount}/${services.length} сервисов`);
  console.log('🏁 Тестирование завершено!');
}

main().catch(console.error);