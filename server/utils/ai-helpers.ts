import axios from 'axios';
import { log } from './logger';

// Кеш для ключевых слов
export const searchCache = new Map<string, { timestamp: number, results: any[] }>();
export const urlKeywordsCache = new Map<string, { timestamp: number, results: any[] }>();
export const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Функция для очистки устаревших записей кеша
 */
export function cleanupExpiredCache() {
  const now = Date.now();
  let removedCount = 0;
  
  // Очищаем кеш для обычных запросов
  for (const [key, entry] of searchCache.entries()) {
    if (now - entry.timestamp > CACHE_DURATION) {
      console.log(`Removing expired cache entry for keyword: ${key}`);
      searchCache.delete(key);
      removedCount++;
    }
  }
  
  // Очищаем кеш для URL-запросов
  for (const [url, entry] of urlKeywordsCache.entries()) {
    if (now - entry.timestamp > CACHE_DURATION) {
      console.log(`Removing expired cache entry for URL: ${url}`);
      urlKeywordsCache.delete(url);
      removedCount++;
    }
  }
  
  console.log(`Cache cleanup completed. Removed ${removedCount} expired entries. Current state: Keywords cache: ${searchCache.size} entries, URL cache: ${urlKeywordsCache.size} entries`);
}

/**
 * Получение кешированных результатов по ключевому слову
 */
export function getCachedResults(keyword: string): any[] | null {
  const cached = searchCache.get(keyword);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`Using cached results for keyword: ${keyword}`);
    return cached.results;
  }
  return null;
}

/**
 * Специальное кеширование для URL-адресов
 */
export function getCachedKeywordsByUrl(url: string): any[] | null {
  const normalizedUrl = url.toLowerCase().trim();
  const cached = urlKeywordsCache.get(normalizedUrl);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`Using cached URL keywords for: ${url}, found ${cached.results.length} items`);
    return cached.results;
  }
  return null;
}

/**
 * Функция для объединения ключевых слов из разных источников  
 */
export function mergeKeywords(geminiKeywords: any[], deepseekKeywords: any[] = []): any[] {
  const keywordMap = new Map<string, any>();
  
  deepseekKeywords.forEach(keyword => {
    if (!keyword?.keyword) return;
    const key = keyword.keyword.toLowerCase().trim();
    if (!keywordMap.has(key)) {
      keywordMap.set(key, { ...keyword, source: 'deepseek' });
    }
  });
  
  geminiKeywords.forEach(keyword => {
    if (!keyword?.keyword) return;
    const key = keyword.keyword.toLowerCase().trim();
    if (!keywordMap.has(key)) {
      keywordMap.set(key, { ...keyword, source: 'gemini' });
    }
  });
  
  return Array.from(keywordMap.values())
    .sort((a, b) => b.trend - a.trend)
    .slice(0, 15);
}

/**
 * Извлекает содержимое сайта с фокусом на контакты
 */
export async function extractFullSiteContent(url: string): Promise<string> {
  try {
    log(`🚀 [SCRAPER] Starting Axios scraping for: ${url}`, 'info');
    
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    log(`🚀 [SCRAPER] Normalized URL: ${normalizedUrl}`, 'info');

    const response = await axios.get(normalizedUrl, {
      timeout: 30000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      validateStatus: (status) => status >= 200 && status < 500 // Принимаем и 404/403 для попытки извлечь хоть что-то
    });
    
    log(`🚀 [SCRAPER] Status: ${response.status} for ${normalizedUrl}`, 'info');

    if (response.status >= 400) {
      log(`🚀 [SCRAPER] Warning: Site returned ${response.status} for ${normalizedUrl}`, 'warn');
    }
    
    let htmlContent = response.data;
    
    // Если это не строка, а объект (например JSON), превращаем в строку
    if (typeof htmlContent !== 'string') {
      log(`🚀 [SCRAPER] Response data is not a string, converting...`, 'info');
      htmlContent = JSON.stringify(htmlContent);
    }
    
    log(`🚀 [SCRAPER] HTML content length: ${htmlContent.length}`, 'info');

    // Пытаемся извлечь текст более чисто, если есть cheerio
    let cleanText = "";
    try {
      const cheerio = await import('cheerio');
      const $ = cheerio.load(htmlContent);
      
      // Удаляем лишнее
      $('script, style, noscript, iframe, svg, header, footer, nav').remove();
      
      cleanText = $('body').text().replace(/\s+/g, ' ').trim();
      log(`🚀 [SCRAPER] Clean text extracted via Cheerio (${cleanText.length} chars)`, 'info');
    } catch (e) {
      log(`🚀 [SCRAPER] Cheerio not available or failed, using regex. Error: ${e}`, 'warn');
      cleanText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    const title = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const description = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() || '';
    
    log(`🚀 [SCRAPER] Title: ${title}, Description: ${description.substring(0, 50)}...`, 'info');
    
    const footerRegex = /<footer[^>]*>[\s\S]*?<\/footer>/gi;
    const contactSectionRegex = /<[^>]*(?:class|id)=["'][^"']*(?:contact|контакт|связ|phone|email|адрес|address|footer|подвал)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;
    
    let footerContent = '';
    const footerMatches = htmlContent.match(footerRegex);
    if (footerMatches) {
      footerContent = footerMatches.join(' ');
    }
    
    const contactSectionMatches = htmlContent.match(contactSectionRegex) || [];
    const contactSectionsContent = contactSectionMatches.join(' ');
    
    const pageEnd = htmlContent.slice(-Math.floor(htmlContent.length * 0.2));
    const priorityContent = footerContent + ' ' + contactSectionsContent + ' ' + pageEnd;
    
    const phoneRegex = /(\+7[\s\-\(\)]?\d{3}[\s\-\(\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}|8[\s\-\(\)]?\d{3}[\s\-\(\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}|8[\s\-]*800[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2})/gi;
    const emailRegex = /([a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    
    let phones = [];
    let emails = [];
    
    const priorityPhones = priorityContent.match(phoneRegex) || [];
    const priorityEmails = priorityContent.match(emailRegex) || [];
    
    const allPhones = priorityPhones.length > 0 ? priorityPhones : (htmlContent.match(phoneRegex) || []);
    const allEmails = priorityEmails.length > 0 ? priorityEmails : (htmlContent.match(emailRegex) || []);
    
    for (let i = 0; i < Math.min(allPhones.length, 10); i++) {
      const cleanPhone = allPhones[i].trim();
      const digits = cleanPhone.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
        phones.push(cleanPhone);
      }
    }
    
    for (let i = 0; i < Math.min(allEmails.length, 10); i++) {
      const cleanEmail = allEmails[i].trim().toLowerCase();
      if (!cleanEmail.includes('example.') && !cleanEmail.includes('@example') && 
          !cleanEmail.includes('test@') && !cleanEmail.includes('name@') &&
          !cleanEmail.includes('noreply') && !cleanEmail.includes('no-reply') &&
          cleanEmail.includes('.') && cleanEmail.length >= 5) {
        emails.push(allEmails[i].trim());
      }
    }
    
    phones = [...new Set(phones)].slice(0, 5);
    emails = [...new Set(emails)].slice(0, 5);
    
    const allContacts = [...phones, ...emails];
    
    const contentParts = [
      `URL: ${url}`,
      title ? `ЗАГОЛОВОК: ${title}` : '',
      description ? `ОПИСАНИЕ: ${description}` : ''
    ];
    
    if (allContacts.length > 0) {
      contentParts.push(`=== НАЙДЕННЫЕ КОНТАКТЫ ===`);
      if (phones.length > 0) contentParts.push(`ТЕЛЕФОНЫ: ${phones.join(', ')}`);
      if (emails.length > 0) contentParts.push(`EMAIL: ${emails.join(', ')}`);
    }
    
    contentParts.push(`КОНТЕНТ ДЛЯ АНАЛИЗА:\n${cleanText.substring(0, 10000)}`);
    
    return contentParts.filter(Boolean).join('\n\n');
  } catch (error: any) {
    console.error(`❌ Ошибка анализа сайта ${url}:`, error.message);
    return `URL: ${url}\nОшибка загрузки сайта: ${error.message}`;
  }
}
