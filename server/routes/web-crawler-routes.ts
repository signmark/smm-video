
import { Router, Request, Response } from 'express';
import { webCrawlerAgent } from '../services/web-crawler-agent';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * Парсинг сайта
 */
router.post('/api/web-crawler/crawl', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { 
      url, 
      needsAuth, 
      credentials, 
      waitFor, 
      extractData,
      userAgent,
      headers
    } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL обязателен'
      });
    }
    
    // Валидация URL
    try {
      const parsedUrl = new URL(url);
      const allowedProtocols = ['http:', 'https:'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        throw new Error('Недопустимый протокол URL');
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный URL'
      });
    }
    
    console.log(`[WEB-CRAWLER-API] 🕷️ Запрос на парсинг от пользователя ${req.userId}: ${url}`);
    
    const result = await webCrawlerAgent.crawlSite({
      url,
      needsAuth,
      credentials,
      waitFor,
      extractData,
      userAgent,
      headers
    });
    
    return res.json(result);
    
  } catch (error: any) {
    console.error('[WEB-CRAWLER-API] ❌ Ошибка:', error.message);
    return res.status(500).json({
      success: false,
      error: `Ошибка парсинга: ${error.message}`
    });
  }
});

/**
 * Интеллектуальный парсинг с AI-анализом
 */
router.post('/api/web-crawler/intelligent-crawl', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { url, analysisPrompt, ...options } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL обязателен'
      });
    }
    
    console.log(`[WEB-CRAWLER-API] 🧠 Интеллектуальный парсинг от пользователя ${req.userId}: ${url}`);
    
    const result = await webCrawlerAgent.intelligentCrawl(url, options);
    
    // Если передан кастомный промпт для анализа, используем его
    if (analysisPrompt) {
      result.analysis = await webCrawlerAgent.analyzePageContent(result.crawlResult, analysisPrompt);
    }
    
    return res.json({
      success: true,
      ...result
    });
    
  } catch (error: any) {
    console.error('[WEB-CRAWLER-API] ❌ Ошибка:', error.message);
    return res.status(500).json({
      success: false,
      error: `Ошибка интеллектуального парсинга: ${error.message}`
    });
  }
});

/**
 * Только AI-анализ уже загруженного контента
 */
router.post('/api/web-crawler/analyze', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { text, title, description, analysisPrompt } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Текст для анализа обязателен'
      });
    }
    
    console.log(`[WEB-CRAWLER-API] 🧠 AI-анализ текста от пользователя ${req.userId}`);
    
    const mockCrawlResult = {
      success: true,
      text,
      metadata: { title, description }
    };
    
    const analysis = await webCrawlerAgent.analyzePageContent(mockCrawlResult, analysisPrompt);
    
    return res.json({
      success: true,
      analysis
    });
    
  } catch (error: any) {
    console.error('[WEB-CRAWLER-API] ❌ Ошибка:', error.message);
    return res.status(500).json({
      success: false,
      error: `Ошибка анализа: ${error.message}`
    });
  }
});

export default router;
