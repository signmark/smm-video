import { Router, Request, Response } from 'express';
import { DeepSeekService, DeepSeekMessage } from './services/deepseek';
import { apiKeyService, ApiServiceName } from './services/api-keys';
import { globalApiKeyManager } from './services/global-api-key-manager';
import { log } from './utils/logger';
import { authenticateUser } from './middleware/user-auth';

export function registerDeepSeekRoutes(app: Router) {
  const router = Router();
  // AI-74: Добавлена аутентификация. userId теперь из проверенной сессии.
  router.use(authenticateUser);
  app.use('/api', router);

  /**
   * Проверка наличия API ключа DeepSeek для текущего пользователя
   */
  async function getDeepSeekApiKey(req: Request): Promise<string | null> {
    try {
      // Сначала пробуем получить ключ из глобальной коллекции
      log('[deepseek-routes] Getting DeepSeek API key from Global API Keys collection');
      
      try {
        const globalKey = await globalApiKeyManager.getApiKey(ApiServiceName.DEEPSEEK);
        if (globalKey) {
          log(`[deepseek-routes] Successfully retrieved DeepSeek API key from Global API Keys (length: ${globalKey.length})`);
          const maskedKey = globalKey.substring(0, 8) + '...' + globalKey.substring(globalKey.length - 4);
          log(`[deepseek-routes] DeepSeek API key: ${maskedKey}`);
          return globalKey;
        }
      } catch (globalError) {
        log(`[deepseek-routes] Global API key retrieval failed: ${globalError instanceof Error ? globalError.message : 'Unknown error'}`);
      }

      // AI-74: userId из проверенной сессии (authenticateUser), не из заголовка
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        log('Cannot get DeepSeek API key: userId is missing in request and no global key available');
        return null;
      }

      // Извлекаем токен из заголовка Authorization
      const authHeader = req.headers.authorization;
      const authToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      
      log(`Getting DeepSeek API key for user ${userId}`);
      log(`Auth token present: ${!!authToken}`);
      
      const apiKey = await apiKeyService.getApiKey(userId, ApiServiceName.DEEPSEEK, authToken);
      
      if (apiKey) {
        log(`Successfully retrieved DeepSeek API key for user ${userId} (length: ${apiKey.length})`);
        // Маскируем ключ для логирования - показываем только первые 4 символа
        const maskedKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
        log(`DeepSeek API key starts with: ${maskedKey}`);
      } else {
        log(`DeepSeek API key not found for user ${userId}`);
      }
      
      return apiKey;
    } catch (error) {
      log('Error getting DeepSeek API key:', (error as Error).message);
      return null;
    }
  }

  /**
   * Получение экземпляра сервиса DeepSeek с API ключом пользователя
   */
  async function getDeepSeekService(req: Request): Promise<DeepSeekService | null> {
    const apiKey = await getDeepSeekApiKey(req);
    
    if (!apiKey) {
      return null;
    }
    
    return new DeepSeekService({ apiKey });
  }

  /**
   * Маршрут для улучшения текста с помощью DeepSeek
   * ПУТЬ БЕЗ /api
   */
  router.post('/deepseek/improve-text', async (req: Request, res: Response) => {
    try {
      const { text, prompt, model } = req.body;
      // AI-74: userId из проверенной сессии
      const userId = (req as any).user?.id as string | undefined;
      
      log(`Received improve-text request from user ${userId}`);
      
      if (!text || !prompt) {
        log('Missing text or prompt in improve-text request');
        return res.status(400).json({
          success: false,
          error: 'Текст и инструкции обязательны'
        });
      }
      
      log(`Getting DeepSeek service for user ${userId}`);
      const deepseekService = await getDeepSeekService(req);
      
      if (!deepseekService) {
        log(`DeepSeek API key not configured for user ${userId}`);
        return res.status(400).json({
          success: false,
          error: 'API ключ DeepSeek не настроен',
          needApiKey: true
        });
      }
      
      // Определяем, содержит ли текст HTML-теги
      const containsHtml = /<[^>]+>/.test(text);
      
      // Формируем сообщения для DeepSeek API
      let systemMessage = '';
      let userMessage = '';
      
      if (containsHtml) {
        systemMessage = `Ты опытный редактор текста для SMM. Выполни задачу: ${prompt}

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Входной текст в HTML-формате — возвращай результат ТОЖЕ в HTML формате.
2. Сохраняй ВСЕ HTML-теги (<p>, <b>, <strong>, <em>, <ul>, <li>, <br> и другие).
3. Сохраняй ВСЕ эмодзи из оригинального текста. Если задача требует — добавляй новые уместные эмодзи.
4. Не добавляй пояснений, комментариев и обёрток вида \`\`\`html. Возвращай ТОЛЬКО HTML-текст.
5. Если задача позволяет — можешь расширить текст, добавив конкретику и детали.`;
        
        userMessage = `Текст для обработки:\n\n${text}`;
      } else {
        systemMessage = `Ты опытный редактор текста для SMM. Выполни задачу: ${prompt}

Сохраняй все эмодзи. Не добавляй пояснений — возвращай только улучшенный текст.`;
        userMessage = `Текст для обработки:\n\n${text}`;
      }
      
      const messages: DeepSeekMessage[] = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ];
      
      // Выбираем модель (или используем дефолтную)
      const modelToUse = model || 'deepseek-chat'; // Используем DeepSeek Chat как модель по умолчанию
      
      log(`Calling DeepSeek with model ${modelToUse}`);
      // Генерируем улучшенный текст
      let improvedText = await deepseekService.generateText(messages, {
        model: modelToUse,
        temperature: 0.3,
        max_tokens: 4000
      });
      
      // Удаляем служебный текст в тройных обратных кавычках (```)
      improvedText = improvedText.replace(/```[\s\S]*?```/g, '');
      
      // Извлекаем только улучшенный контент, убираем объяснения DeepSeek
      const explanationPatterns = [
        /\(Note:.*?\)/gi,
        /\(Примечание:.*?\)/gi,
        /Note:.*$/gmi,
        /Примечание:.*$/gmi,
        /I made.*$/gmi,
        /Я сделал.*$/gmi,
        /The original.*$/gmi,
        /Оригинальный.*$/gmi,
        /This version.*$/gmi,
        /Эта версия.*$/gmi
      ];
      
      explanationPatterns.forEach(pattern => {
        improvedText = improvedText.replace(pattern, '');
      });
      
      // Очищаем лишние пробелы и переносы
      improvedText = improvedText
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
      
      // Если оригинальный текст содержал HTML, но ответ не содержит, 
      // попробуем заключить абзацы в теги <p>
      if (containsHtml && !/<[^>]+>/.test(improvedText)) {
        log('HTML tags were not preserved in DeepSeek response, attempting to add paragraph tags');
        improvedText = improvedText
          .split('\n\n')
          .map(para => para.trim())
          .filter(para => para.length > 0)
          .map(para => `<p>${para}</p>`)
          .join('\n');
      }
      
      log('Text improved successfully with DeepSeek, returning response');
      return res.json({
        success: true,
        text: improvedText
      });
    } catch (error) {
      log('Error improving text with DeepSeek:', (error as Error).message);
      
      // Более детальное логирование ошибки
      if (error instanceof Error) {
        log(`Error message: ${error.message}`);
        if ('stack' in error) {
          log(`Error stack: ${error.stack}`);
        }
        
        // Проверяем, связана ли ошибка с API ключом
        if (error.message.includes('API ключ') || error.message.includes('API key')) {
          return res.status(400).json({
            success: false,
            error: error.message,
            needApiKey: true
          });
        }
      }
      
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка при улучшении текста'
      });
    }
  });

  /**
   * Маршрут для получения списка доступных моделей DeepSeek
   * ПУТЬ БЕЗ /api
   */
  router.get('/deepseek/models', async (_req: Request, res: Response) => {
    try {
      // Список поддерживаемых моделей DeepSeek
      const models = [
        {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          description: 'Основная и мощная модель DeepSeek для генерации текста',
          default: true
        },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner',
          description: 'Модель DeepSeek с улучшенными навыками логического мышления',
          default: false
        }
      ];
      
      return res.json({
        success: true,
        models
      });
    } catch (error: any) {
      log('Error getting DeepSeek models:', (error as Error).message);
      return res.status(500).json({
        success: false,
        error: error.message || 'Произошла ошибка при получении списка моделей DeepSeek'
      });
    }
  });

  return router;
}