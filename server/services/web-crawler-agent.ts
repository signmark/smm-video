import axios from 'axios';
import { geminiDirect } from './gemini-direct';
import * as logger from '../utils/logger';
import { execSync } from 'child_process';
import { aiService } from './ai-service';

// Puppeteer опционален — если не установлен, работаем через Axios
let puppeteer: any = null;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('[WEB-CRAWLER] Puppeteer не установлен, работаем через Axios');
}

type Browser = any;
type Page = any;

interface CrawlerOptions {
  url: string;
  needsAuth?: boolean;
  credentials?: {
    username?: string;
    password?: string;
    loginUrl?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  };
  waitFor?: string; // CSS selector to wait for
  extractData?: {
    selectors: Record<string, string>;
    description: string;
  };
  userAgent?: string;
  headers?: Record<string, string>;
}

interface CrawlerResult {
  success: boolean;
  data?: any;
  text?: string;
  html?: string;
  screenshots?: string[];
  error?: string;
  metadata?: {
    title?: string;
    description?: string;
    keywords?: string[];
    loadTime?: number;
  };
}

export class WebCrawlerAgent {
  private browser: Browser | null = null;
  
  /**
   * Интеллектуальный парсинг сайта с возможностью авторизации
   */
  async crawlSite(options: CrawlerOptions): Promise<CrawlerResult> {
    const startTime = Date.now();

    // Если Puppeteer не установлен — сразу Axios fallback
    if (!puppeteer) {
      console.log(`[WEB-CRAWLER] Puppeteer недоступен, Axios fallback для: ${options.url}`);
      return await this.fallbackAxios(options, startTime);
    }

    try {
      console.log(`[WEB-CRAWLER] Начинаем парсинг: ${options.url}`);
      console.log(`[WEB-CRAWLER] Запуск Puppeteer Chromium...`);

      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process', // Важно для некоторых контейнеров
        ]
      };

      // Попытка автоматически найти путь к Chromium в разных средах
      const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/app/.apt/usr/bin/google-chrome'
      ];

      for (const path of possiblePaths) {
        try {
          if (execSync(`test -f ${path} && echo "exists"`).toString().trim() === 'exists') {
            launchOptions.executablePath = path;
            console.log(`[WEB-CRAWLER] 🔍 Found Chromium at: ${path}`);
            break;
          }
        } catch (e) {}
      }
      
      this.browser = await puppeteer.launch(launchOptions);
      log(`[WEB-CRAWLER] 🚀 Puppeteer started successfully`, 'info');
      
      // const context = await this.browser.createIncognitoBrowserContext();
      // const page = await context.newPage();
      const page = await this.browser.newPage();
      log(`[WEB-CRAWLER] 📄 New page created`, 'info');
      await page.setUserAgent(options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      if (options.headers) {
        log(`[WEB-CRAWLER] 🛠️ Setting extra headers`, 'info');
        await page.setExtraHTTPHeaders(options.headers);
      }
      
      // Авторизация если нужна
      if (options.needsAuth && options.credentials) {
        log(`[WEB-CRAWLER] 🔐 Выполняем авторизацию на ${options.credentials.loginUrl}`, 'info');
        await this.performLogin(page, options.credentials);
      }
      
      // Переходим на целевую страницу
      log(`[WEB-CRAWLER] 🌐 Загружаем страницу: ${options.url}`, 'info');
      const response = await page.goto(options.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      if (!response || !response.ok()) {
        log(`[WEB-CRAWLER] ❌ Failed to load page: ${response?.status()}`, 'error');
        throw new Error(`Не удалось загрузить страницу: ${response?.status()}`);
      }
      
      log(`[WEB-CRAWLER] ✅ Page loaded: ${response.status()}`, 'info');

      // Ждем загрузки контента
      if (options.waitFor) {
        log(`[WEB-CRAWLER] ⏳ Ждем элемент: ${options.waitFor}`, 'info');
        await page.waitForSelector(options.waitFor, { timeout: 15000 });
      }
      
      // Даем немного времени для динамического контента
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Получаем данные страницы
      log(`[WEB-CRAWLER] 🔍 Evaluating page content...`, 'info');
      const pageData = await page.evaluate(() => {
        // Собираем все ссылки для возможного дальнейшего перехода (пока просто логируем)
        const links = Array.from(document.querySelectorAll('a'))
          .map(a => ({ text: a.innerText, href: a.href }))
          .filter(l => l.href.startsWith(window.location.origin) || l.href.startsWith('/'));
        
        // Очищаем страницу от лишних элементов перед извлечением текста
        const scriptTags = document.querySelectorAll('script, style, noscript, iframe, svg, header, footer, nav');
        scriptTags.forEach(tag => tag.remove());
        
        // Получаем основной текст
        const bodyText = document.body.innerText;
        
        // Добавляем мета-данные в текст для AI
        const metaText = `
          Title: ${document.title}
          Description: ${(document.querySelector('meta[name="description"]') as any)?.content || ''}
          Keywords: ${(document.querySelector('meta[name="keywords"]') as any)?.content || ''}
        `;
        
        return {
          title: document.title,
          description: (document.querySelector('meta[name="description"]') as any)?.content || '',
          keywords: (document.querySelector('meta[name="keywords"]') as any)?.content?.split(',') || [],
          text: metaText + '\n' + bodyText,
          html: document.documentElement.outerHTML,
          links: links.slice(0, 20) // Берем первые 20 ссылок
        };
      });

      console.log("CRAWLED_HTML_LENGTH:", pageData.html.length);
      
      // Извлекаем специфичные данные если задано
      let extractedData = {};
      if (options.extractData) {
        console.log(`[WEB-CRAWLER] 🎯 Извлекаем данные: ${options.extractData.description}`);
        extractedData = await this.extractSpecificData(page, options.extractData.selectors);
      }
      
      const loadTime = Date.now() - startTime;
      
      console.log(`[WEB-CRAWLER] ✅ Парсинг завершен за ${loadTime}ms. Текст: ${pageData.text.length} символов.`);
      
      return {
        success: true,
        data: extractedData,
        text: pageData.text,
        html: pageData.html,
        metadata: {
          title: pageData.title,
          description: pageData.description,
          keywords: pageData.keywords,
          loadTime
        }
      };
      
    } catch (error: any) {
      console.error('[WEB-CRAWLER] ❌ Ошибка парсинга:', error.message);
      
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }
  }

  private async fallbackAxios(options: CrawlerOptions, startTime: number): Promise<CrawlerResult> {
    try {
      const response = await axios.get(options.url, {
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
        },
      });

      const cheerio = await import('cheerio').catch(() => null);
      let text = '';

      if (cheerio) {
        const $ = cheerio.load(response.data);
        $('script, style, noscript, iframe, svg, header, footer, nav').remove();
        text = $('body').text().replace(/\s+/g, ' ').trim();
      } else {
        text = String(response.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      const loadTime = Date.now() - startTime;
      console.log(`[WEB-CRAWLER] Axios fallback: ${text.length} chars за ${loadTime}ms`);

      return {
        success: text.length > 50,
        text,
        html: String(response.data).substring(0, 10000),
        metadata: {
          title: response.data.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim(),
          loadTime
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Выполнение авторизации на сайте
   */
  private async performLogin(page: Page, credentials: any): Promise<void> {
    try {
      // Переходим на страницу входа
      await page.goto(credentials.loginUrl, { waitUntil: 'networkidle2' });
      
      // Ждем форму входа
      const userSelector = credentials.usernameSelector || 'input[type="email"], input[name="username"], input[name="login"]';
      await page.waitForSelector(userSelector);
      
      // Заполняем форму
      if (credentials.username) {
        await page.type(userSelector, credentials.username);
      }
      
      if (credentials.password) {
        const passSelector = credentials.passwordSelector || 'input[type="password"]';
        await page.type(passSelector, credentials.password);
      }
      
      // Отправляем форму
      if (credentials.submitSelector) {
        await page.click(credentials.submitSelector);
      } else {
        await page.keyboard.press('Enter');
      }
      
      // Ждем перехода после авторизации
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      
      console.log('[WEB-CRAWLER] ✅ Авторизация выполнена успешно');
      
    } catch (error: any) {
      console.error('[WEB-CRAWLER] ❌ Ошибка авторизации:', error.message);
      throw new Error(`Не удалось выполнить авторизацию: ${error.message}`);
    }
  }
  
  /**
   * Извлечение специфичных данных по селекторам
   */
  private async extractSpecificData(page: Page, selectors: Record<string, string>): Promise<any> {
    const data: any = {};
    
    for (const [key, selector] of Object.entries(selectors)) {
      try {
        const elements = await page.$$(selector);
        
        if (elements.length === 1) {
          data[key] = await page.$eval(selector, (el: any) => el.innerText);
        } else if (elements.length > 1) {
          data[key] = await page.$$eval(selector, (els: any[]) => 
            els.map(el => el.innerText || el.textContent || el.value)
          );
        } else {
          data[key] = null;
        }
      } catch (error) {
        console.warn(`[WEB-CRAWLER] ⚠️ Не удалось извлечь данные для селектора ${selector}:`, error);
        data[key] = null;
      }
    }
    
    return data;
  }
  
  /**
   * AI-анализ содержимого страницы
   */
  async analyzePageContent(crawlResult: CrawlerResult, analysisPrompt?: string): Promise<any> {
    if (!crawlResult.success || !crawlResult.text) {
      throw new Error('Нет данных для анализа');
    }
    
    const defaultPrompt = `
Проанализируй содержимое веб-страницы и извлеки информацию о бизнесе.
Ты ОБЯЗАН выдать JSON строго с этими 13 полями:
1. companyName - Название компании
2. contactInfo - Контактная информация
3. businessDescription - Описание бизнеса
4. mainActivities - Основные направления
5. brandImage - Имидж бренда
6. productsServices - Продукты и услуги
7. targetAudience - Целевая аудитория
8. customerResults - Результаты для клиентов
9. companyFeatures - Особенности компании
10. businessValues - Ценности бизнеса
11. productBeliefs - Убеждения о продукте
12. competitiveAdvantages - Конкурентные преимущества
13. marketingExpectations - Ожидания от маркетинга

ВАЖНО: Если информации на сайте нет, постарайся сделать логическое предположение на основе контекста. 
Например, если это сайт Playwright, то продуктом является фреймворк для тестирования.
В поле contactInfo включи ссылки на GitHub, социальные сети или документацию, если нет прямой почты.
Не пиши "Не найдено", если можно извлечь хоть какую-то полезную информацию.
Текст страницы:
${crawlResult.text.substring(0, 15000)}

Верни результат СТРОГО в формате JSON.`;
    
    // Если передан кастомный промпт, добавляем к нему текст страницы
    const finalPrompt = analysisPrompt 
      ? `${analysisPrompt}\n\nТекст страницы для анализа:\n${crawlResult.text.substring(0, 15000)}`
      : defaultPrompt;
    
    try {
      log(`[WEB-CRAWLER] 🤖 Отправляем текст в AI для анализа (${crawlResult.text.length} символов)`, 'info');
      
      // Use unified aiService for better key management
      const analysisResultRaw = await aiService.generateContent({ 
        prompt: finalPrompt, 
        model: 'gemini-3-flash-preview',
        service: 'gemini-3-flash-preview'
      });
      
      const analysisResult = analysisResultRaw.content;
      log(`[WEB-CRAWLER] 🤖 AI response received (${analysisResult.length} chars)`, 'info');
      
      // Пытаемся извлечь JSON из ответа
      try {
        const cleanResult = analysisResult.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanResult.match(/\{[\s\S]*\}/);
        
        let parsed;
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = JSON.parse(cleanResult);
        }

        // Sanitize keys (remove whitespace/invisible chars)
        const sanitized: any = {};
        for (const key in parsed) {
            sanitized[key.trim()] = parsed[key];
        }
        log(`[WEB-CRAWLER] ✅ JSON parsed and sanitized`, 'info');
        return sanitized;
      } catch (parseError) {
        log(`[WEB-CRAWLER] ⚠️ Не удалось распарсить JSON из ответа AI, возвращаем как есть. Error: ${parseError}`, 'warn');
        return { analysis: analysisResult };
      }
    } catch (error: any) {
      log(`[WEB-CRAWLER] ❌ Ошибка AI-анализа: ${error.message}`, 'error');
      throw new Error(`Ошибка анализа содержимого: ${error.message}`);
    }
  }
  
  /**
   * Парсинг сайта с автоматическим определением структуры
   */
  async intelligentCrawl(url: string, options?: Partial<CrawlerOptions>): Promise<{
    crawlResult: CrawlerResult;
    analysis: any;
  }> {
    console.log(`[WEB-CRAWLER] 🧠 Интеллектуальный парсинг: ${url}`);
    
    // Базовый парсинг
    const crawlResult = await this.crawlSite({
      url,
      ...options
    });
    
    if (!crawlResult.success) {
      throw new Error(`Ошибка парсинга: ${crawlResult.error}`);
    }
    
    // AI-анализ
    const analysis = await this.analyzePageContent(crawlResult);
    
    return {
      crawlResult,
      analysis
    };
  }
}

export const webCrawlerAgent = new WebCrawlerAgent();
