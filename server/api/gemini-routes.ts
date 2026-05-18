import express from 'express';
import { geminiService } from '../services/gemini';
import { apiKeyService } from '../services/api-key-service';
import * as logger from '../utils/logger';

export const geminiRouter = express.Router();

/**
 * Проверяет наличие API ключа Gemini для пользователя
 * @param req Запрос Express
 * @param res Ответ Express
 * @param next Функция для продолжения цепочки обработки запроса
 */
const checkGeminiApiKey = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user?.id;
    const token = req.user?.token;

    if (!userId) {
      logger.log('[express] No user ID found in request');
      return res.status(401).json({ 
        success: false, 
        error: 'Пользователь не авторизован' 
      });
    }

    // Получаем API ключ Gemini из хранилища ключей
    const apiKey = await apiKeyService.getApiKey(userId, 'gemini', token);
    
    if (!apiKey) {
      logger.log(`[gemini-routes] Gemini API key not configured for user ${userId}`);
      return res.status(400).json({ 
        success: false, 
        error: 'API ключ Gemini не настроен', 
        needApiKey: true 
      });
    }

    // Устанавливаем API ключ в сервис Gemini для текущего запроса
    geminiService.updateApiKey(apiKey);
    next();
  } catch (error) {
    logger.error('[gemini-routes] Error checking Gemini API key:', error);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка при проверке API ключа Gemini: ${(error as Error).message}` 
    });
  }
};

/**
 * Тестирует доступность API Gemini
 * GET /api/gemini/test
 */
geminiRouter.get('/test', checkGeminiApiKey, async (req, res) => {
  try {
    logger.log('[gemini-routes] Testing Gemini API connection...');
    
    // Проверяем валидность API ключа
    const isKeyValid = await geminiService.testApiKey();
    
    if (isKeyValid) {
      logger.log('[gemini-routes] Gemini API test successful');
      return res.status(200).json({ 
        success: true, 
        message: 'Успешное подключение к Gemini API' 
      });
    } else {
      logger.error('[gemini-routes] Gemini API test failed - invalid key');
      return res.status(400).json({ 
        success: false, 
        error: 'Недействительный API ключ Gemini или ошибка подключения' 
      });
    }
  } catch (error) {
    logger.error('[gemini-routes] Error testing Gemini API:', error);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка при тестировании Gemini API: ${(error as Error).message}` 
    });
  }
});

/**
 * Улучшает текст с помощью Gemini API
 * POST /api/gemini/improve-text
 * Body: { text: string, prompt?: string }
 */
geminiRouter.post('/improve-text', checkGeminiApiKey, async (req, res) => {
  try {
    logger.log('[gemini-routes] Processing improve-text request...');
    logger.log(`[gemini-routes] Request body: ${JSON.stringify(req.body)}`);
    
    const { text, prompt } = req.body;
    
    if (!text) {
      logger.log('[gemini-routes] Missing text in request');
      return res.status(400).json({ 
        success: false, 
        error: 'Текст отсутствует в запросе' 
      });
    }
    
    // Используем предоставленные инструкции или дефолтные, если не указаны
    const defaultInstructions = 'Сделай этот текст более интересным и профессиональным';
    const instructions = prompt || defaultInstructions;
    
    logger.log(`[gemini-routes] Processing text with instructions: ${instructions.substring(0, 50)}...`);
    
    // Используем метод improveText из сервиса Gemini
    const result = await geminiService.improveText({
      text,
      prompt: instructions,
      model: 'gemini-3-flash-preview'
    });
    
    logger.log('[gemini-routes] Text successfully improved');
    
    return res.status(200).json({
      success: true,
      originalText: text,
      improvedText: result
    });
  } catch (error) {
    logger.error('[gemini-routes] Error improving text:', error);
    return res.status(500).json({
      success: false,
      error: `Ошибка при улучшении текста: ${(error as Error).message}`
    });
  }
});

/**
 * Генерирует текст с помощью Gemini API
 * POST /api/gemini/generate-text
 * Body: { prompt: string, model?: string }
 */
geminiRouter.post('/generate-text', checkGeminiApiKey, async (req, res) => {
  try {
    const { prompt, model = 'gemini-3-flash-preview' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует запрос для генерации текста'
      });
    }
    
    logger.log(`[gemini-routes] Generating text with model ${model}`);
    
    const generatedText = await geminiService.generateText(prompt, model);
    
    return res.status(200).json({
      success: true,
      generatedText,
      model
    });
  } catch (error) {
    logger.error('[gemini-routes] Error generating text:', error);
    return res.status(500).json({
      success: false,
      error: `Ошибка при генерации текста: ${(error as Error).message}`
    });
  }
});
