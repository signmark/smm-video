import express from 'express';
import { geminiService } from '../services/gemini';
import * as logger from '../utils/logger';

/**
 * Маршруты для тестирования сервиса Gemini API через SOCKS5 прокси
 */
export const geminiTestRouter = express.Router();

// Проверка работоспособности Gemini API
geminiTestRouter.get('/test', async (req, res) => {
  try {
    logger.log('[gemini-test] Проверка работы Gemini API...');
    
    // Проверка валидности API ключа
    const isKeyValid = await geminiService.testApiKey();
    
    if (isKeyValid) {
      logger.log('[gemini-test] Проверка успешна. API ключ и соединение работают.');
      return res.status(200).json({ success: true, message: 'Gemini API успешно подключен через SOCKS5 прокси' });
    } else {
      logger.error('[gemini-test] Проверка неудачна. API ключ недействителен.');
      return res.status(400).json({ success: false, message: 'Недействительный API ключ Gemini или проблема соединения с сервисом' });
    }
  } catch (error) {
    logger.error('[gemini-test] Ошибка при тестировании Gemini API:', error);
    return res.status(500).json({ success: false, message: `Ошибка при тестировании Gemini API: ${(error as Error).message}` });
  }
});

// Тест улучшения текста
geminiTestRouter.post('/improve-text', async (req, res) => {
  try {
    // Записываем в логи информацию о запросе
    logger.log('[gemini-test] Получен запрос на улучшение текста');
    logger.log('[gemini-test] Body: ' + JSON.stringify(req.body));
    
    // Проверяем наличие текста в запросе
    const { text, prompt: userPrompt } = req.body;
    
    if (!text) {
      logger.log('[gemini-test] Отсутствует текст в запросе');
      return res.status(400).json({ 
        success: false, 
        error: 'Текст отсутствует в запросе. Пожалуйста, укажите параметр "text".' 
      });
    }
    
    logger.log('[gemini-test] Улучшение текста через Gemini API...');
    logger.log(`[gemini-test] Оригинальный текст: ${text.substring(0, 50)}...`);
    
    // Создаем промпт для улучшения текста
    // Используем инструкции от пользователя или дефолтные
    const defaultInstructions = 'Сделай этот текст более интересным и профессиональным';
    const instructions = userPrompt || defaultInstructions;
    
    // Используем метод improveText из сервиса Gemini
    const result = await geminiService.improveText({
      text: text,
      prompt: instructions,
      model: 'gemini-3-flash-preview'
    });
    
    logger.log('[gemini-test] Текст успешно улучшен');
    logger.log(`[gemini-test] Улучшенный текст: ${result.substring(0, 50)}...`);
    
    // Возвращаем успешный ответ
    return res.status(200).json({ 
      success: true, 
      originalText: text, 
      improvedText: result 
    });
  } catch (error) {
    logger.error('[gemini-test] Ошибка при улучшении текста:', error);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка при улучшении текста: ${(error as Error).message}` 
    });
  }
});
