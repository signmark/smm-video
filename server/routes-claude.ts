import { Router, Request, Response } from 'express';
import { ClaudeService } from './services/claude';
import { ApiKeyService, ApiServiceName } from './services/api-keys';
import * as logger from './utils/logger';
import { authenticateUser } from './middleware/user-auth';

/**
 * AI-74: Глобальный declare userId удалён. userId теперь из проверенной
 * сессии (req.user.id), а не из непроверенного заголовка x-user-id.
 */

export function registerClaudeRoutes(app: Router) {
  const router = Router();
  router.use(authenticateUser);
  // Монтируем на /api
  app.use('/api', router);
  
  // Создаем экземпляр ApiKeyService
  const apiKeyServiceInstance = new ApiKeyService();
  
  /**
   * Получение API ключа Claude из централизованной системы Global API Keys
   */
  async function getClaudeApiKey(req: Request): Promise<string | null> {
    try {
      logger.log('[claude-routes] Getting Claude API key from Global API Keys collection', 'claude');
      
      // Импортируем централизованный менеджер API ключей
      const { globalApiKeyManager } = await import('./services/global-api-key-manager');
      const { ApiServiceName } = await import('./services/api-keys');
      
      const apiKey = await globalApiKeyManager.getApiKey(ApiServiceName.CLAUDE);
      
      if (apiKey) {
        logger.log(`[claude-routes] Successfully retrieved Claude API key from Global API Keys (length: ${apiKey.length})`, 'claude');
        // Маскируем ключ для логирования - показываем только первые 4 символа
        const maskedKey = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
        logger.log(`[claude-routes] Claude API key: ${maskedKey}`, 'claude');
      } else {
        logger.error('[claude-routes] Claude API key not found in Global API Keys collection', 'claude');
      }
      
      return apiKey;
    } catch (error) {
      logger.error('[claude-routes] Error getting Claude API key:', error);
      return null;
    }
  }

  /**
   * Получение экземпляра сервиса Claude с API ключом пользователя
   */
  async function getClaudeService(req: Request): Promise<ClaudeService | null> {
    const apiKey = await getClaudeApiKey(req);
    
    if (!apiKey) {
      return null;
    }
    
    return new ClaudeService(apiKey);
  }

  /**
   * Маршрут для тестирования API ключа Claude
   */
  router.post('/claude/test-api-key', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        logger.error('[claude-routes] API key not provided in test-api-key request');
        return res.status(400).json({
          success: false,
          error: 'API ключ не указан'
        });
      }
      
      logger.log(`[claude-routes] Testing Claude API key, length: ${apiKey.length}, starts with: ${apiKey.substring(0, 4)}...`);
      const claudeService = new ClaudeService(apiKey);
      const isValid = await claudeService.testApiKey();
      
      logger.log(`[claude-routes] Claude API key test result: ${isValid ? 'Valid' : 'Invalid'}`);
      
      return res.json({
        success: true,
        isValid: isValid
      });
    } catch (error) {
      logger.error('[claude-routes] Error testing Claude API key:', error);
      return res.status(500).json({
        success: false,
        error: 'Ошибка при проверке API ключа'
      });
    }
  });

  /**
   * Маршрут для сохранения API ключа Claude
   */
  router.post('/claude/save-api-key', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      // AI-74: userId from authenticated session
      const userId = (req as any).user?.id as string | undefined;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Пользователь не авторизован'
        });
      }
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API ключ не указан'
        });
      }
      
      // Проверяем работоспособность ключа перед сохранением
      const claudeService = new ClaudeService(apiKey);
      const isValid = await claudeService.testApiKey();
      
      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Недействительный API ключ Claude'
        });
      }
      
      // Сохраняем ключ в хранилище
      const success = await apiKeyServiceInstance.saveApiKey(userId, ApiServiceName.CLAUDE, apiKey);
      
      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Ошибка при сохранении API ключа'
        });
      }
      
      return res.json({
        success: true
      });
    } catch (error) {
      logger.error('[claude-routes] Error saving Claude API key:', error);
      return res.status(500).json({
        success: false,
        error: 'Ошибка при сохранении API ключа'
      });
    }
  });

  /**
   * Маршрут для улучшения текста с помощью Claude
   */
  router.post('/claude/improve-text', async (req: Request, res: Response) => {
    try {
      const { text, prompt, model } = req.body;
      // AI-74: userId from authenticated session
      const userId = (req as any).user?.id as string | undefined;
      
      logger.log(`[claude-routes] Received improve-text request from user ${userId}`, 'claude');
      logger.log(`[claude-routes] Request data: text length=${text?.length}, prompt length=${prompt?.length}, model=${model}`, 'claude');
      
      if (!text || !prompt) {
        logger.error('[claude-routes] Missing text or prompt in improve-text request', 'claude');
        return res.status(400).json({
          success: false,
          error: 'Текст и инструкции обязательны'
        });
      }
      
      logger.log(`[claude-routes] Getting Claude service for user ${userId}`, 'claude');
      const claudeService = await getClaudeService(req);
      
      if (!claudeService) {
        logger.error(`[claude-routes] Claude API key not configured for user ${userId}`, 'claude');
        return res.status(400).json({
          success: false,
          error: 'API ключ Claude не настроен',
          needApiKey: true
        });
      }
      
      logger.log(`[claude-routes] Claude service initialized successfully`, 'claude');
      logger.log(`[claude-routes] Calling improveText with model ${model || 'default'}`, 'claude');
      
      const improvedText = await claudeService.improveText({ text, prompt, model });
      
      logger.log(`[claude-routes] Claude response: ${improvedText.substring(0, 100)}...`, 'claude');
      
      // Профессиональная конвертация Markdown в HTML
      const convertMarkdownToHtml = (markdown: string): string => {
        let html = markdown;
        
        // Сначала обрабатываем блочные элементы
        // Заголовки (должны быть в начале строки)
        html = html.replace(/^### (.+)$/gm, '<h3><strong>$1</strong></h3>');
        html = html.replace(/^## (.+)$/gm, '<h2><strong>$1</strong></h2>');
        html = html.replace(/^# (.+)$/gm, '<h1><strong>$1</strong></h1>');
        
        // Затем обрабатываем инлайн-элементы
        // Жирный текст (сохраняем как <strong>)
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
        
        // Курсив (сохраняем как <em>)
        html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
        
        // Удаляем остатки кода
        html = html.replace(/```[\s\S]*?```/g, '');
        html = html.replace(/`([^`]+)`/g, '$1');
        
        // Убираем ссылки markdown, оставляем только текст
        html = html.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        
        // Обрабатываем списки - убираем маркеры
        html = html.replace(/^\s*[-*+]\s+/gm, '');
        html = html.replace(/^\s*\d+\.\s+/gm, '');
        
        // Убираем цитаты
        html = html.replace(/^\s*>\s+/gm, '');
        
        // Убираем горизонтальные линии
        html = html.replace(/^[-=*]{3,}$/gm, '');
        
        // Разбиваем на параграфы более аккуратно
        const paragraphs = html.split(/\n\s*\n/);
        const processedParagraphs = paragraphs.map(para => {
          const trimmed = para.trim();
          if (!trimmed) return '';
          
          // Если уже есть HTML-теги, не оборачиваем в <p>
          if (trimmed.match(/^<(h[1-6]|div|blockquote|ul|ol|li)/)) {
            return trimmed;
          }
          
          // Заменяем одиночные переносы на пробелы внутри параграфа
          const cleanPara = trimmed.replace(/\n/g, ' ').replace(/\s+/g, ' ');
          
          // Оборачиваем в параграф
          return `<p>${cleanPara}</p>`;
        });
        
        return processedParagraphs.filter(p => p.trim()).join('');
      };
      
      // Определяем, есть ли HTML в оригинальном тексте
      const hasOriginalHtml = text.includes('<') && text.includes('>');
      
      // Проверяем наличие Markdown символов в результате
      const hasMarkdownSymbols = improvedText.includes('#') || improvedText.includes('**') || improvedText.includes('*');
      logger.log(`[claude-routes] AI результат содержит Markdown: ${hasMarkdownSymbols}`, 'claude');
      logger.log(`[claude-routes] Оригинальный текст содержал HTML: ${hasOriginalHtml}`, 'claude');
      
      // Применяем конвертацию
      let finalText = improvedText;
      
      // Если оригинальный текст содержал HTML или результат содержит Markdown - обрабатываем соответственно
      if (hasOriginalHtml || hasMarkdownSymbols) {
        if (hasMarkdownSymbols) {
          logger.log('[claude-routes] Конвертируем Markdown в HTML', 'claude');
          finalText = convertMarkdownToHtml(improvedText);
          
          // Очищаем проблемы с двойными параграфами и лишними пробелами
          finalText = finalText
            .replace(/<p><p>/g, '<p>')  // Убираем двойные открывающие <p>
            .replace(/<\/p><\/p>/g, '</p>')  // Убираем двойные закрывающие </p>
            .replace(/<p>\s*<\/p>/g, '')  // Убираем пустые параграфы
            .replace(/^\s+/, '')  // Убираем пробелы в начале
            .replace(/\s+$/, '')  // Убираем пробелы в конце
            .trim();
          
          logger.log(`[claude-routes] После конвертации: ${finalText.substring(0, 100)}...`, 'claude');
        } else if (hasOriginalHtml) {
          // Проверяем, содержит ли улучшенный текст HTML теги
          if (/<[^>]+>/.test(improvedText)) {
            // Если текст уже содержит HTML теги, просто очищаем лишние пробелы
            logger.log('[claude-routes] Текст уже содержит HTML, очищаем форматирование', 'claude');
            finalText = improvedText.trim();
          } else {
            // Если в оригинале был HTML, но в ответе его нет - оборачиваем в параграф
            logger.log('[claude-routes] Оборачиваем текст в HTML параграф', 'claude');
            finalText = `<p>${improvedText.replace(/\n\n+/g, '</p><p>').replace(/\n/g, ' ')}</p>`;
          }
        }
      } else {
        // Просто очищаем от возможных markdown символов
        finalText = improvedText
          .replace(/^#+\s+/gm, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
          .replace(/^\s*[-*+]\s+/gm, '')
          .replace(/^\s*\d+\.\s+/gm, '')
          .replace(/^\s*>\s+/gm, '')
          .replace(/^[-=*]{3,}$/gm, '')
          .replace(/\n\s*\n+/g, '\n')
          .trim();
        logger.log('[claude-routes] Очистили от markdown символов', 'claude');
      }
      
      logger.log('[claude-routes] Text improved successfully, returning response', 'claude');
      return res.json({
        success: true,
        text: finalText
      });
    } catch (error) {
      logger.error('[claude-routes] Error improving text with Claude:', error);
      
      // Более детальное логирование ошибки
      if (error instanceof Error) {
        logger.error(`[claude-routes] Error message: ${error.message}`, 'claude');
        if ('stack' in error) {
          logger.error(`[claude-routes] Error stack: ${error.stack}`, 'claude');
        }
      }
      
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка при улучшении текста'
      });
    }
  });

  /**
   * Маршрут для генерации социального контента с помощью Claude
   */
  router.post('/claude/generate-social-content', async (req: Request, res: Response) => {
    try {
      const { keywords, prompt, platform, tone, model } = req.body;
      // AI-74: userId from authenticated session
      const userId = (req as any).user?.id as string | undefined;
      
      logger.log(`[claude-routes] Received generate-social-content request from user ${userId} for platform ${platform}`, 'claude');
      
      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        logger.error('[claude-routes] Missing or invalid keywords in request', 'claude');
        return res.status(400).json({
          success: false,
          error: 'Ключевые слова обязательны и должны быть в формате массива'
        });
      }
      
      if (!prompt) {
        logger.error('[claude-routes] Missing prompt in request', 'claude');
        return res.status(400).json({
          success: false,
          error: 'Промпт обязателен'
        });
      }
      
      logger.log(`[claude-routes] Getting Claude service for user ${userId}`, 'claude');
      const claudeService = await getClaudeService(req);
      
      if (!claudeService) {
        logger.error(`[claude-routes] Claude API key not configured for user ${userId}`, 'claude');
        return res.status(400).json({
          success: false,
          error: 'API ключ Claude не настроен',
          needApiKey: true
        });
      }
      
      logger.log(`[claude-routes] Generating social content with model ${model || 'default'} for platform ${platform || 'general'}`, 'claude');
      const generatedContent = await claudeService.generateSocialContent(
        keywords,
        prompt,
        {
          platform,
          tone,
          model
        }
      );
      
      logger.log('[claude-routes] Social content generated successfully, returning response', 'claude');
      return res.json({
        success: true,
        content: generatedContent,
        service: 'claude'
      });
    } catch (error) {
      logger.error('[claude-routes] Error generating social content with Claude:', error);
      
      // Более детальное логирование ошибки
      if (error instanceof Error) {
        logger.error(`[claude-routes] Error message: ${error.message}`, 'claude');
        if ('stack' in error) {
          logger.error(`[claude-routes] Error stack: ${error.stack}`, 'claude');
        }
      }
      
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка при генерации социального контента'
      });
    }
  });

  return router;
}