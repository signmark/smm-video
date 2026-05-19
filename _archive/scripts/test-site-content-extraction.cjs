const axios = require('axios');

const testSiteContentExtraction = async () => {
  console.log('🔍 Тестируем извлечение контента с реальных сайтов...\n');

  const extractFullSiteContent = async (url) => {
    try {
      console.log(`📡 Запрашиваем контент с ${url}...`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 8000,
        maxContentLength: 2 * 1024 * 1024, // 2MB
      });

      const html = response.data;
      console.log(`📄 Получен HTML размером: ${html.length} символов`);

      // Извлекаем title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // Извлекаем meta description
      const metaDescMatch = html.match(/<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']*)["\'][^>]*>/i);
      const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : '';

      // Извлекаем заголовки H1-H3
      const headingMatches = html.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi) || [];
      const headings = [];
      for (let i = 0; i < Math.min(45, headingMatches.length); i++) {
        const heading = headingMatches[i].replace(/<[^>]*>/g, '').trim();
        if (heading) headings.push(heading);
      }

      // Извлекаем параграфы
      const paragraphMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi) || [];
      const paragraphs = [];
      for (let i = 0; i < Math.min(30, paragraphMatches.length); i++) {
        const paragraph = paragraphMatches[i].replace(/<[^>]*>/g, '').trim();
        if (paragraph && paragraph.length > 20) paragraphs.push(paragraph);
      }

      // КОНТАКТНАЯ ИНФОРМАЦИЯ - ищем телефоны и email
      console.log('🔍 Ищем контактную информацию...');
      
      // Российские телефоны
      const phoneRegex = /(?:\+7|8)[\s\-\(\)]?\d{1,4}[\s\-\(\)]?\d{1,4}[\s\-\(\)]?\d{2,4}[\s\-\(\)]?\d{2,4}/g;
      const phones = html.match(phoneRegex) || [];
      
      // Email адреса
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = html.match(emailRegex) || [];
      
      // Ищем контактные разделы
      const contactSections = [];
      const contactRegex = /<[^>]*(?:class|id)=["\'][^"\']*(?:contact|контакт)[^"\']*["\'][^>]*>(.*?)<\/[^>]*>/gi;
      const contactMatches = html.match(contactRegex) || [];
      
      console.log(`📞 Найдено телефонов: ${phones.length}`);
      console.log(`📧 Найдено email: ${emails.length}`);
      console.log(`🏢 Найдено контактных секций: ${contactMatches.length}`);
      
      if (phones.length > 0) console.log('📞 Телефоны:', phones);
      if (emails.length > 0) console.log('📧 Email:', emails);

      let extractedContent = '';
      
      if (title) extractedContent += `ЗАГОЛОВОК: ${title}\n\n`;
      if (metaDescription) extractedContent += `ОПИСАНИЕ: ${metaDescription}\n\n`;
      
      if (headings.length > 0) {
        extractedContent += `ЗАГОЛОВКИ:\n${headings.join('\n')}\n\n`;
      }
      
      if (paragraphs.length > 0) {
        extractedContent += `ОСНОВНОЙ КОНТЕНТ:\n${paragraphs.join('\n\n')}\n\n`;
      }

      // Добавляем найденные контакты в контент
      if (phones.length > 0 || emails.length > 0) {
        extractedContent += `НАЙДЕННЫЕ КОНТАКТЫ:\n`;
        if (phones.length > 0) extractedContent += `Телефоны: ${phones.join(', ')}\n`;
        if (emails.length > 0) extractedContent += `Email: ${emails.join(', ')}\n`;
        extractedContent += '\n';
      }

      if (contactMatches.length > 0) {
        extractedContent += `КОНТАКТНЫЕ РАЗДЕЛЫ:\n${contactMatches.slice(0, 5).join('\n')}\n\n`;
      }

      // Ограничиваем размер до 15KB
      if (extractedContent.length > 15000) {
        extractedContent = extractedContent.substring(0, 15000) + '...';
      }

      console.log(`📊 Итоговый размер контента: ${extractedContent.length} символов`);
      console.log(`🔍 Содержит контакты: ${(phones.length > 0 || emails.length > 0) ? 'ДА' : 'НЕТ'}`);

      return extractedContent;

    } catch (error) {
      console.error(`❌ Ошибка при обработке ${url}:`, error.message);
      return '';
    }
  };

  // Тестируем несколько сайтов
  const testSites = [
    'https://yandex.ru',
    'https://nplanner.ru'
  ];

  for (const site of testSites) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌐 ТЕСТИРУЕМ: ${site}`);
    console.log('='.repeat(60));
    
    const content = await extractFullSiteContent(site);
    
    if (content) {
      console.log('\n📋 ИЗВЛЕЧЕННЫЙ КОНТЕНТ (первые 1000 символов):');
      console.log(content.substring(0, 1000) + (content.length > 1000 ? '...' : ''));
    } else {
      console.log('❌ Контент не извлечен');
    }
    
    console.log('\n⏳ Пауза 2 секунды...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n✅ Тестирование завершено!');
};

testSiteContentExtraction().catch(console.error);