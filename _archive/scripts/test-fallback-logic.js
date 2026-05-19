/**
 * Тест логики fallback для анализа сайтов
 */

import axios from 'axios';

// Имитируем функцию extractFullSiteContent
async function testExtractContent(url) {
  try {
    console.log(`🚀 Анализ сайта: ${url}`);
    
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    const response = await axios.get(normalizedUrl, {
      timeout: 8000,
      maxContentLength: 2 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    const htmlContent = response.data;
    
    // Извлечение данных
    const title = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const description = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() || '';
    
    const h1s = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/gi)?.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 8) || [];
    
    // Определение типа бизнеса
    let businessType = 'общая';
    const contentLower = (title + ' ' + description + ' ' + h1s.join(' ')).toLowerCase();
    
    if (contentLower.includes('example')) {
      businessType = 'Демонстрационный сайт';
    }
    
    const result = {
      url,
      title,
      description, 
      businessType,
      contentLength: htmlContent.length,
      extractedData: h1s
    };
    
    console.log('✅ Успешно извлечен контент:', result);
    return result;
    
  } catch (error) {
    console.log(`❌ Ошибка извлечения: ${error.message}`);
    
    // Fallback логика
    const domain = url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    const businessName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
    
    const fallbackResult = {
      url,
      title: `${businessName} - Fallback Analysis`,
      description: 'Сайт недоступен, используется интеллектуальный анализ домена',
      businessType: 'Определяется по домену',
      isFallback: true,
      fallbackData: {
        companyName: businessName,
        businessValues: 'Профессионализм, качество, клиентоориентированность',
        productBeliefs: 'Стремимся к excellence в своей области'
      }
    };
    
    console.log('🔄 Fallback результат:', fallbackResult);
    return fallbackResult;
  }
}

async function runTests() {
  console.log('🧪 ТЕСТИРОВАНИЕ ИЗВЛЕЧЕНИЯ КОНТЕНТА И FALLBACK\n');
  
  const urls = [
    'https://example.com',
    'https://nonexistent-site-123456.com',
    'https://github.com',
    'invalid-url'
  ];
  
  for (const url of urls) {
    console.log(`\n📍 Тестируем: ${url}`);
    console.log('='.repeat(50));
    
    const result = await testExtractContent(url);
    
    console.log(`🏷️ Тип бизнеса: ${result.businessType}`);
    if (result.isFallback) {
      console.log(`🛠️ Fallback данные:`, result.fallbackData);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🎉 Тестирование завершено');
}

runTests().catch(console.error);