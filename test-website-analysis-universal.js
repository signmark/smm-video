/**
 * Тестовый скрипт для проверки улучшенной системы анализа ЛЮБЫХ сайтов
 * Проверяет качество извлечения контента и fallback логику
 */

import axios from 'axios';

async function testWebsiteAnalysis() {
  console.log('🧪 ТЕСТИРОВАНИЕ УНИВЕРСАЛЬНОЙ СИСТЕМЫ АНАЛИЗА САЙТОВ\n');
  
  // Разнообразные типы сайтов для тестирования
  const testUrls = [
    'https://example.com',           // Простой тестовый сайт
    'https://github.com',            // IT платформа
    'https://stackoverflow.com',     // Техническое сообщество
    'https://wikipedia.org',         // Информационный портал
    'https://amazon.com',            // Интернет-магазин
    'https://mcdonalds.com',         // Ресторанный бизнес
    'https://mit.edu',               // Образование
    'https://who.int',               // Медицина/здравоохранение
    'https://invalid-site-12345.com' // Несуществующий сайт (fallback тест)
  ];

  for (const url of testUrls) {
    console.log(`\n📍 Тестируем: ${url}`);
    console.log('=' + '='.repeat(50));
    
    try {
      const response = await axios.post('http://localhost:5000/api/website-analysis', {
        url: url
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        const data = response.data.data;
        console.log(`✅ Анализ успешен`);
        console.log(`📊 Название: ${data.companyName}`);
        console.log(`🏢 Описание: ${data.businessDescription?.substring(0, 100)}...`);
        console.log(`🎯 Целевая аудитория: ${data.targetAudience}`);
        console.log(`💎 Ценности бизнеса: ${data.businessValues}`);
        console.log(`🔮 Философия продукта: ${data.productBeliefs}`);
        
        // Проверяем качество заполнения критических полей
        const criticalFields = ['businessValues', 'productBeliefs'];
        let qualityScore = 0;
        
        criticalFields.forEach(field => {
          if (data[field] && data[field].length > 10 && !data[field].includes('undefined')) {
            qualityScore += 50;
          }
        });
        
        console.log(`🏆 Качество анализа: ${qualityScore}% (критические поля)`);
        
      } else {
        console.log(`❌ Ошибка анализа: ${response.data.error}`);
      }
      
    } catch (error) {
      console.log(`💥 Сетевая ошибка: ${error.message}`);
      
      if (error.response?.data) {
        console.log(`📋 Детали ошибки: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }
    
    // Пауза между запросами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО');
  console.log('📈 Результаты показывают качество работы с различными типами сайтов');
}

// Запуск тестирования
testWebsiteAnalysis().catch(console.error);