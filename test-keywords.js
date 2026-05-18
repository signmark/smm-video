#!/usr/bin/env node

/**
 * Простой тест для проверки поиска ключевых слов через Gemini 2.5 Flash
 */

const axios = require('axios');

async function testKeywordSearch() {
  console.log('🧪 Тестируем поиск ключевых слов через Gemini 2.5 Flash...\n');
  
  try {
    const response = await axios.post('http://localhost:5000/api/keywords/search', {
      keyword: 'смартфон'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`,
      },
      timeout: 30000
    });

    console.log('✅ Успешный ответ от API!');
    console.log('📊 Источник:', response.data.source || 'не указан');
    console.log('💬 Сообщение:', response.data.message || 'не указано');
    console.log('🔑 Количество ключевых слов:', response.data.data?.keywords?.length || 0);
    
    if (response.data.data?.keywords?.length > 0) {
      console.log('\n📝 Первые 5 ключевых слов:');
      response.data.data.keywords.slice(0, 5).forEach((keyword, index) => {
        console.log(`  ${index + 1}. ${keyword.keyword} (тренд: ${keyword.trend}, конкуренция: ${keyword.competition})`);
      });
    }

    // Проверяем источник генерации
    if (response.data.source === 'gemini_2.5_flash') {
      console.log('\n🎉 ОТЛИЧНО! Используется настоящий Gemini 2.5 Flash');
    } else if (response.data.source === 'fallback') {
      console.log('\n⚠️  Используется fallback, Gemini не смог обработать запрос');
    } else {
      console.log('\n🤔 Неизвестный источник данных');
    }

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.response?.data || error.message);
  }
}

// Запускаем тест
testKeywordSearch();