/**
 * Тестовый скрипт для проверки интеграции Claude с данными кампании
 */

import axios from 'axios';

const BASE_URL = 'http://0.0.0.0:5000';

/**
 * Тестирует Claude с данными кампании
 */
async function testClaudeWithCampaignData() {
  console.log('🧪 Тестирование Claude с данными кампании...\n');

  try {
    // 1. Тест Claude БЕЗ данных кампании
    console.log('📝 Тест 1: Claude БЕЗ данных кампании');
    const responseWithoutCampaign = await axios.post(`${BASE_URL}/api/generate-content`, {
      prompt: 'Создай пост о здоровом питании',
      service: 'claude',
      useCampaignData: false
    });

    console.log('✅ Результат БЕЗ данных кампании:');
    console.log(responseWithoutCampaign.data.content.substring(0, 200) + '...\n');

    // 2. Тест Claude С данными кампании
    console.log('📝 Тест 2: Claude С данными кампании');
    const responseWithCampaign = await axios.post(`${BASE_URL}/api/generate-content`, {
      prompt: 'Создай пост о здоровом питании',
      service: 'claude',
      useCampaignData: true,
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
    });

    console.log('✅ Результат С данными кампании:');
    console.log(responseWithCampaign.data.content.substring(0, 200) + '...\n');

    // 3. Анализ различий
    console.log('🔍 Анализ различий:');
    const withoutCampaign = responseWithoutCampaign.data.content.toLowerCase();
    const withCampaign = responseWithCampaign.data.content.toLowerCase();

    console.log('Содержит ли версия БЕЗ кампании "nplanner.ru":', withoutCampaign.includes('nplanner.ru'));
    console.log('Содержит ли версия С кампанией "nplanner.ru":', withCampaign.includes('nplanner.ru'));
    console.log('Содержит ли версия БЕЗ кампании "ниап":', withoutCampaign.includes('ниап'));
    console.log('Содержит ли версия С кампанией "ниап":', withCampaign.includes('ниап'));

    if (withCampaign.includes('nplanner.ru') || withCampaign.includes('ниап')) {
      console.log('\n🎉 УСПЕХ: Claude корректно использует данные кампании!');
    } else {
      console.log('\n❌ ПРОБЛЕМА: Claude не использует данные кампании');
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.response?.data || error.message);
  }
}

// Запускаем тест
testClaudeWithCampaignData();