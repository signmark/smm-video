#!/usr/bin/env node

import axios from 'axios';

async function testSiteAnalysis() {
  console.log('🧪 Тестирование анализа сайта...');
  
  try {
    console.log('1. Тестируем простую загрузку сайта...');
    const response = await axios.get('https://nplanner.ru/', {
      timeout: 5000,
      maxContentLength: 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SiteAnalyzer/1.0)',
        'Accept': 'text/html'
      }
    });
    
    const htmlContent = response.data;
    console.log(`✅ Сайт загружен: ${htmlContent.length} символов`);
    
    // Простое извлечение
    const title = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const description = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() || '';
    
    console.log(`📝 Заголовок: ${title}`);
    console.log(`📄 Описание: ${description}`);
    
    // Формируем контент
    const content = [
      `URL: https://nplanner.ru/`,
      title ? `ЗАГОЛОВОК: ${title}` : '',
      description ? `ОПИСАНИЕ: ${description}` : '',
      `КОНТЕНТ ДЛЯ АНАЛИЗА:\n${htmlContent.substring(0, 8000)}`
    ].filter(Boolean).join('\n\n');
    
    console.log(`📊 Итоговый контент: ${content.length} символов`);
    
    console.log('2. Тестируем Gemini API...');
    
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.log('❌ GEMINI_API_KEY не найден');
      return;
    }
    
    console.log(`🔑 API ключ: ${geminiApiKey.substring(0, 10)}...`);
    
    // Тестируем без импорта - просто проверим можем ли получить ключи
    console.log('✅ Сайт обработан, тестируем Gemini API напрямую...');
    
    // Прямой тест API без GeminiProxyService
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    const requestBody = {
      contents: [{
        parts: [{
          text: `Проанализируй сайт nplanner.ru и создай 5 ключевых слов в JSON формате: [{"keyword": "слово", "trend": 80, "competition": 50}]`
        }]
      }]
    };
    
    const geminiResponse = await axios.post(testUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    
    console.log('✅ Прямой тест Gemini API успешен');
    const geminiText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`📝 Ответ: ${geminiText?.substring(0, 200)}...`);
    
    return;
    const geminiProxy = new GeminiProxyService({ apiKey: geminiApiKey });
    
    console.log('✅ GeminiProxyService создан');
    
    const prompt = `Проанализируй сайт и создай 5 ключевых слов в JSON формате:
${content.substring(0, 1000)}

Результат в формате: [{"keyword": "слово", "trend": 80, "competition": 50}]`;
    
    console.log('🤖 Отправляем запрос к Gemini...');
    const result = await geminiProxy.generateText(prompt, 'gemini-2.5-flash');
    
    console.log(`✅ Ответ получен: ${result.substring(0, 200)}...`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('Stack:', error.stack);
  }
}

testSiteAnalysis();