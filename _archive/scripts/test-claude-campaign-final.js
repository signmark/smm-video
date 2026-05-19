/**
 * Финальный тест Claude с данными кампании
 */

import axios from 'axios';

const BASE_URL = 'http://0.0.0.0:5000';

// Получаем токен из браузера (из логов видно такой токен)
const AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTc0ODQ1MjIwOCwiZXhwIjoxNzQ4NDUzMTA4LCJpc3MiOiJkaXJlY3R1cyJ9.OZ4qmYKRw52jd4j8ESsAffWcO5EQyo-BKHwPg7fvd_Y';

/**
 * Тестирует Claude С данными кампании
 */
async function testClaudeWithAuth() {
  console.log('🧪 Тестирование Claude С данными кампании (с авторизацией)...\n');

  try {
    console.log('📝 Тест: Claude С данными кампании');
    const response = await axios.post(`${BASE_URL}/api/generate-content`, {
      prompt: 'Создай короткий пост о компании и её услугах с призывом к действию и ссылкой на сайт',
      service: 'claude',
      useCampaignData: true,
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
      platform: 'facebook',
      tone: 'professional'
    }, {
      headers: {
        'Authorization': AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Результат С данными кампании:');
    console.log('='.repeat(80));
    console.log(response.data.content);
    console.log('='.repeat(80));

    // Проверяем ключевые элементы
    const content = response.data.content.toLowerCase();
    
    console.log('\n🔍 Анализ содержания:');
    console.log('Содержит "ниап":', content.includes('ниап'));
    console.log('Содержит "nplanner":', content.includes('nplanner'));
    console.log('Содержит "врач" или "нутрициолог":', content.includes('врач') || content.includes('нутрициолог'));
    console.log('Содержит "рацион" или "диета":', content.includes('рацион') || content.includes('диета'));
    
    // Проверяем наличие выдуманных данных
    console.log('\n❌ Проверка на выдуманные данные:');
    console.log('Содержит выдуманные названия:', content.includes('нутрилайф') || content.includes('здоровье'));
    console.log('Содержит выдуманные ссылки:', content.includes('.com') || content.includes('.org'));

    if ((content.includes('ниап') || content.includes('nplanner')) && 
        (content.includes('врач') || content.includes('нутрициолог'))) {
      console.log('\n🎉 УСПЕХ: Claude правильно использует данные кампании!');
    } else {
      console.log('\n❌ ПРОБЛЕМА: Claude не использует данные кампании должным образом');
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.response?.data || error.message);
  }
}

// Запускаем тест
testClaudeWithAuth();