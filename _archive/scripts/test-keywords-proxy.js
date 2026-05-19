#!/usr/bin/env node

import axios from 'axios';
import crypto from 'crypto';

async function testKeywordsAnalysis() {
  try {
    console.log('🧪 Тестирование анализа ключевых слов через GeminiProxyService...');
    
    // Импортируем сервис без расширения .js
    const { GeminiProxyService } = await import('./server/services/gemini-proxy');
    
    // Инициализируем с API ключом из .env
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY не найден в .env');
    }
    
    console.log(`🔑 API ключ: ${geminiApiKey.substring(0, 10)}...`);
    
    const geminiProxy = new GeminiProxyService({ apiKey: geminiApiKey });
    
    console.log('✅ GeminiProxyService создан');
    
    // Тестовый контент для анализа
    const testContent = `
    НИАП — профессиональный аналитический сервис для врачей и нутрициологов. 
    Создавайте персональные сбалансированные рационы до 80% быстрее и проводите оценку состояния ваших клиентов.
    `;
    
    const contextualPrompt = `Проанализируй содержимое сайта nplanner.ru и создай 10-15 релевантных ключевых слов именно для этого бизнеса.

Контент сайта:
${testContent}

СТРОГИЕ ТРЕБОВАНИЯ:
- ЗАПРЕЩЕНО создавать общие ключевые слова типа "SEO", "маркетинг", "онлайн сервис" если сайт НЕ ОБ ЭТОМ!
- Анализируй РЕАЛЬНЫЙ контент и создавай ключевые слова именно по ЭТОЙ тематике
- Для медицинского сайта - медицинские термины
- Для SMM платформы - SMM термины  
- Для кулинарного сайта - кулинарные термины

Верни результат строго в формате JSON:
[
  {"keyword": "точное ключевое слово по тематике", "trend": 85, "competition": 60},
  {"keyword": "другое релевантное слово", "trend": 75, "competition": 45}
]`;

    console.log('🚀 Отправляем запрос к GeminiProxyService...');
    
    const geminiText = await geminiProxy.generateText({ 
      prompt: contextualPrompt, 
      model: 'gemini-2.5-flash' 
    });
    
    console.log('✅ Ответ получен от GeminiProxyService');
    console.log(`📝 Ответ: ${geminiText.substring(0, 200)}...`);
    
    // Парсим JSON из ответа
    const jsonMatch = geminiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const keywords = JSON.parse(jsonMatch[0]);
      console.log(`✅ Получены ключевые слова: ${keywords.length}`);
      
      keywords.slice(0, 5).forEach((kw, i) => {
        console.log(`  ${i+1}. "${kw.keyword}" (trend: ${kw.trend}, competition: ${kw.competition})`);
      });
      
      return keywords;
    } else {
      console.log(`❌ Не найден JSON массив в ответе`);
      return [];
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('Stack:', error.stack);
    return [];
  }
}

// Запускаем тест
testKeywordsAnalysis()
  .then(keywords => {
    console.log(`🎯 Тест завершен. Получено ключевых слов: ${keywords.length}`);
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Фатальная ошибка:', error.message);
    process.exit(1);
  });