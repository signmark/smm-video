import { Router, type Request, type Response, Express } from 'express';
import { GeminiService, geminiService } from './services/gemini';
import { geminiDirect } from './services/gemini-direct';
import { GeminiProxyService } from './services/gemini-proxy';
import { ApiKeyService, ApiServiceName } from './services/api-keys';
import * as logger from './utils/logger';

/**
 * Регистрирует маршруты для работы с Gemini API
 * @param app Express приложение
 */
export function registerGeminiRoutes(app: Express) {
  const router = Router();
  // Монтируем на /api
  app.use('/api', router);
  
  // Создаем экземпляр ApiKeyService
  const apiKeyServiceInstance = new ApiKeyService();
  
  /**
   * Получает экземпляр сервиса Gemini для пользователя
   * @param req Запрос Express
   * @returns Экземпляр GeminiService или null, если ключ не настроен
   */
  async function getGeminiService(req: Request): Promise<GeminiService | null> {
    const apiKey = await getGeminiApiKey(req);
    
    if (!apiKey) {
      return null;
    }
    
    return new GeminiService({ apiKey });
  }
  
  /**
   * Получает API ключ Gemini из глобальной системы API ключей
   * @param req Запрос Express
   * @returns API ключ или null, если не настроен
   */
  async function getGeminiApiKey(req: Request): Promise<string | null> {
    try {
      logger.log('[gemini-routes] Getting Gemini API key from Global API Keys collection', 'gemini');
      
      // Импортируем централизованный менеджер API ключей
      const { globalApiKeyManager } = await import('./services/global-api-key-manager');
      const { ApiServiceName } = await import('./services/api-keys');
      
      const apiKey = await globalApiKeyManager.getApiKey(ApiServiceName.GEMINI);
      
      if (apiKey) {
        logger.log(`[gemini-routes] Successfully retrieved Gemini API key from Global API Keys (length: ${apiKey.length})`, 'gemini');
        const maskedKey = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
        logger.log(`[gemini-routes] Gemini API key: ${maskedKey}`, 'gemini');
      } else {
        logger.error('[gemini-routes] Gemini API key not found in Global API Keys collection', 'gemini');
      }
      
      return apiKey;
    } catch (error) {
      logger.error('[gemini-routes] Error getting Gemini API key:', error);
      return null;
    }
  }

  /**
   * Маршрут для улучшения текста с помощью Gemini через SOCKS5 прокси
   * ПУТЬ БЕЗ /api
   */
  router.post('/gemini/improve-text', async (req: Request, res: Response) => {
    try {
      const { text, prompt, model = 'gemini-3-flash-preview' } = req.body;
      
      logger.log(`[gemini-routes] Received improve-text request with model: ${model}`, 'gemini');
      
      if (!text || !prompt) {
        logger.log('[gemini-routes] Missing text or prompt in improve-text request', 'gemini');
        return res.status(400).json({
          success: false,
          error: 'Текст и инструкции обязательны'
        });
      }
      
      let improvedText: string;
      
      {
        // Получаем реальный API ключ из env (Google AI Studio, не Vertex AI)
        const apiKey = process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
          logger.log('[gemini-routes] GEMINI_API_KEY not found in env', 'warn');
        }
        
        logger.log(`[gemini-routes] Using Google AI Studio for model: ${model}, key prefix: ${apiKey.substring(0, 8)}...`, 'gemini');
        
        const hasHtml = text.includes('<p') || text.includes('<b>') || text.includes('<em>') || text.includes('<ul') || text.includes('<li');
        const systemNote = hasHtml
          ? `СИСТЕМНЫЕ ТРЕБОВАНИЯ: Входной текст в формате HTML. Ты ОБЯЗАН вернуть результат в HTML формате. Сохрани все HTML теги (<p>, <b>, <em>, <ul>, <li>, <br> и другие). Сохрани ВСЕ эмодзи из оригинала. Не добавляй никаких пояснений, только HTML-текст.`
          : `СИСТЕМНЫЕ ТРЕБОВАНИЯ: Верни только текст без пояснений, обёрток и разметки кода.`;
        const improvePrompt = `${systemNote}\n\n${prompt}\n\nТЕКСТ ДЛЯ ОБРАБОТКИ:\n${text}`;
        
        // Используем GeminiProxyService с реальным ключом — он идёт в Google AI Studio
        const proxyService = new GeminiProxyService({ apiKey });
        improvedText = await proxyService.improveText({ text, prompt: improvePrompt, model });
        
        // Убираем markdown-обёртки кода которые AI иногда добавляет
        improvedText = improvedText
          .replace(/^```html\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
      }
      
      return res.json({
        success: true,
        text: improvedText
      });
    } catch (error) {
      logger.log(`[gemini-routes] Error improving text with Gemini: ${(error as Error).message}`, 'gemini');
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при улучшении текста: ${(error as Error).message}`
      });
    }
  });
  
  /**
   * Маршрут для тестирования API ключа Gemini
   * ПУТЬ БЕЗ /api
   */
  router.post('/gemini/test-api-key', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API ключ обязателен'
        });
      }
      
      logger.log('[gemini-routes] Testing Gemini API key', 'gemini');
      
      // Тестируем ключ API
      const geminiService = new GeminiService({ apiKey });
      const isValid = await geminiService.testApiKey();
      
      if (!isValid) {
        logger.log('[gemini-routes] Invalid Gemini API key provided', 'gemini');
        return res.status(400).json({
          success: false,
          error: 'Недействительный API ключ Gemini. Пожалуйста, проверьте ключ и попробуйте снова.'
        });
      }
      
      logger.log('[gemini-routes] Gemini API key is valid', 'gemini');
      return res.json({
        success: true,
        message: 'API ключ Gemini действителен'
      });
    } catch (error) {
      logger.log(`[gemini-routes] Error testing Gemini API key: ${(error as Error).message}`, 'gemini');
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при проверке API ключа: ${(error as Error).message}`
      });
    }
  });

  /**
   * Маршрут для сохранения API ключа Gemini
   * ПУТЬ БЕЗ /api
   */
  router.post('/gemini/save-api-key', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      const userId = (req as any).userId || (req as any).user?.id;
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API ключ обязателен'
        });
      }
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация'
        });
      }
      
      // Проверяем валидность ключа
      const geminiService = new GeminiService({ apiKey });
      const isValid = await geminiService.testApiKey();
      
      if (!isValid) {
        logger.log(`[gemini-routes] Invalid Gemini API key provided by user ${userId}`, 'gemini');
        return res.status(400).json({
          success: false,
          error: 'Недействительный API ключ Gemini'
        });
      }
      
      // Сохраняем ключ в базу данных
      await apiKeyServiceInstance.saveApiKey(userId, ApiServiceName.GEMINI, apiKey);
      
      logger.log(`[gemini-routes] Successfully saved Gemini API key for user ${userId}`, 'gemini');
      
      return res.json({
        success: true
      });
    } catch (error) {
      logger.log(`[gemini-routes] Error saving Gemini API key: ${(error as Error).message}`, 'gemini');
      
      return res.status(500).json({
        success: false,
        error: 'Ошибка при сохранении API ключа'
      });
    }
  });
  
  logger.log('Gemini routes registered successfully at /api', 'gemini');
}