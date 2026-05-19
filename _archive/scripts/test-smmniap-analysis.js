/**
 * Тест анализа smmniap.pw с правильным токеном
 */

import axios from 'axios';

async function testSMMNiapAnalysis() {
  console.log('🧪 Тестирование анализа smmniap.pw...\n');
  
  try {
    console.log('📍 Анализируем: https://smmniap.pw');
    
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: 'https://smmniap.pw'
    }, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      }
    });

    if (response.data.success) {
      const data = response.data.data;
      console.log(`✅ Анализ успешен`);
      console.log(`\n📊 РЕЗУЛЬТАТ АНАЛИЗА:`);
      console.log(`📝 Название: ${data.companyName}`);
      console.log(`🏢 Описание: ${data.businessDescription}`);
      console.log(`🎯 Целевая аудитория: ${data.targetAudience}`);
      console.log(`💎 Ценности бизнеса: ${data.businessValues}`);
      console.log(`🔮 Философия продукта: ${data.productBeliefs}`);
      console.log(`🚀 Основные направления: ${data.mainDirections}`);
      console.log(`⚡ Преимущества: ${data.competitiveAdvantages}`);
      
      // Проверяем качество анализа
      const hasGoodSMMAnalysis = (
        data.companyName.toLowerCase().includes('smm') ||
        data.businessDescription.toLowerCase().includes('социальн') ||
        data.businessDescription.toLowerCase().includes('автоматизац') ||
        data.targetAudience.toLowerCase().includes('smm') ||
        data.targetAudience.toLowerCase().includes('маркетолог')
      );
      
      console.log(`\n🔍 КАЧЕСТВО АНАЛИЗА SMM-ПЛАТФОРМЫ: ${hasGoodSMMAnalysis ? '✅ ХОРОШО' : '❌ ПЛОХО'}`);
      
      if (!hasGoodSMMAnalysis) {
        console.log('❌ Система не распознала smmniap.pw как SMM-платформу!');
        console.log('Нужно улучшить промпты и логику анализа');
      }
      
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

testSMMNiapAnalysis().catch(console.error);