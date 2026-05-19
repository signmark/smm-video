const axios = require('axios');

const testWebsiteContactAnalysis = async () => {
  console.log('🧪 Тестируем анализ сайтов с улучшенным извлечением контактов...\n');

  const testSites = [
    'https://nplanner.ru',
    'https://smmniap.pw', 
    'https://yandex.ru',
    'https://example.com'
  ];

  for (const site of testSites) {
    console.log(`\n🌐 Тестируем сайт: ${site}`);
    console.log('=' + '='.repeat(50));

    try {
      const response = await axios.post('http://localhost:5000/api/website-analysis', {
        websiteUrl: site,
        campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e' // тестовая кампания
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        const data = response.data.data;
        
        console.log(`✅ Анализ успешен для ${site}`);
        console.log(`📊 Заполнено полей: ${Object.values(data).filter(v => v && v.trim() !== '').length}/13`);
        console.log(`\n📝 Результаты анализа:`);
        console.log(`📌 Название компании: "${data.companyName}"`);
        console.log(`📞 Контактная информация: "${data.contactInfo}"`);
        console.log(`📋 Описание бизнеса: "${data.businessDescription.substring(0, 100)}..."`);
        console.log(`🎯 Целевая аудитория: "${data.targetAudience}"`);
        console.log(`💎 Ценности бизнеса: "${data.businessValues}"`);
        console.log(`🧠 Убеждения о продукте: "${data.productBeliefs}"`);
        console.log(`🏆 Конкурентные преимущества: "${data.competitiveAdvantages}"`);
        
        // Специальная проверка контактной информации
        if (data.contactInfo && data.contactInfo !== 'Контактная информация не представлена на данной странице') {
          console.log(`\n✅ КОНТАКТЫ НАЙДЕНЫ! ${data.contactInfo}`);
        } else {
          console.log(`\n❌ Контакты не найдены или не извлечены`);
        }
        
      } else {
        console.log(`❌ Ошибка анализа: ${response.data.error}`);
      }

    } catch (error) {
      console.log(`❌ Ошибка при тестировании ${site}:`);
      if (error.response) {
        console.log(`   Статус: ${error.response.status}`);
        console.log(`   Ошибка: ${error.response.data.error || error.response.data}`);
      } else {
        console.log(`   ${error.message}`);
      }
    }
  }

  console.log('\n✅ Тестирование завершено!');
  console.log('📝 Система анализа сайтов с улучшенным извлечением контактов проверена.');
};

// Запускаем тест
testWebsiteContactAnalysis();