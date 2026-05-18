/**
 * Создание полностью упрощенной функции анализа сайта
 * для решения критической проблемы подвисания сервера
 */

import fs from 'fs';

const simplifiedSiteAnalysis = `
/**
 * УПРОЩЕННАЯ ФУНКЦИЯ АНАЛИЗА САЙТА - БЕЗ ПОДВИСАНИЙ
 * Заменяет проблемные extractFullSiteContent функции
 */
async function extractFullSiteContentSimplified(url: string): Promise<string> {
  try {
    console.log(\`🚀 Быстрый анализ сайта: \${url}\`);
    
    // Нормализуем URL
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = \`https://\${normalizedUrl}\`;
    }
    
    // МАКСИМАЛЬНО АГРЕССИВНЫЕ ОГРАНИЧЕНИЯ
    const response = await axios.get(normalizedUrl, {
      timeout: 5000, // КРИТИЧЕСКИ ВАЖНО: 5 секунд максимум
      maxContentLength: 1024 * 1024, // 1MB максимум
      maxBodyLength: 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SiteAnalyzer/1.0)',
        'Accept': 'text/html'
      },
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    const htmlContent = response.data;
    
    // ПРОСТОЕ ИЗВЛЕЧЕНИЕ БЕЗ ЦИКЛОВ
    const title = htmlContent.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
    const description = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
    
    // БЫСТРОЕ ИЗВЛЕЧЕНИЕ ЗАГОЛОВКОВ (МАКСИМУМ 5 ШТУК)
    const h1s = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/gi)?.slice(0, 5) || [];
    const h2s = htmlContent.match(/<h2[^>]*>([^<]+)<\/h2>/gi)?.slice(0, 5) || [];
    
    // ФОРМИРУЕМ КОРОТКИЙ РЕЗУЛЬТАТ
    const result = [
      \`URL: \${url}\`,
      title ? \`TITLE: \${title}\` : '',
      description ? \`DESCRIPTION: \${description}\` : '',
      h1s.length > 0 ? \`H1: \${h1s.join(', ')}\` : '',
      h2s.length > 0 ? \`H2: \${h2s.join(', ')}\` : ''
    ].filter(Boolean).join('\\n\\n');
    
    console.log(\`✅ Анализ завершен за \${Date.now() - startTime}ms\`);
    return result.substring(0, 5000); // Максимум 5KB
    
  } catch (error) {
    console.error(\`❌ Ошибка анализа сайта \${url}:\`, error.message);
    return \`URL: \${url}\\n\\nОшибка: Не удалось получить доступ к сайту. Проверьте URL и попробуйте позже.\`;
  }
}
`;

console.log('📝 Создание упрощенной функции анализа сайта...');
fs.writeFileSync('simplified-site-analysis.txt', simplifiedSiteAnalysis);
console.log('✅ Упрощенная функция сохранена в simplified-site-analysis.txt');
console.log('🔧 Теперь можно заменить проблемные функции extractFullSiteContent в server/routes.ts');