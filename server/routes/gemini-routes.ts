import express, { Request, Response } from 'express';
import * as geminiService from '../services/gemini-proxy';
import { geminiProxyService } from '../services/gemini-proxy';
import { log as logger } from '../utils/logger';

export const geminiRouter = express.Router();



/**
 * Тестирует доступность API Gemini
 * GET /api/gemini/test
 */
geminiRouter.get('/test', async (req, res) => {
  try {
    logger.log('[gemini-routes] Проверка работы Gemini API...');
    
    // Проверяем доступность API ключа
    const isKeyValid = await geminiService.testApiKey();
    
    if (isKeyValid) {
      logger.log('[gemini-routes] Проверка успешна. API ключ и соединение работают');
      return res.status(200).json({ 
        success: true, 
        message: 'Gemini API успешно подключен через SOCKS5 прокси' 
      });
    } else {
      logger.error('[gemini-routes] Проверка неудачна. API ключ недействителен');
      return res.status(400).json({ 
        success: false, 
        error: 'Недействительный API ключ Gemini или проблема соединения с сервисом' 
      });
    }
  } catch (error) {
    logger.error('[gemini-routes] Ошибка при тестировании Gemini API:', error);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка при тестировании Gemini API: ${(error as Error).message}` 
    });
  }
});

/**
 * Улучшает текст с помощью Gemini API
 * POST /api/gemini/improve-text
 * Body: { text: string, prompt?: string, model?: string }
 */
geminiRouter.post('/improve-text', async (req, res) => {
  try {
    const { text, prompt, model = 'gemini-3-flash-preview' } = req.body;

    logger(`[gemini-routes] Received improve-text request with model: ${model}`);

    if (!text) {
      return res.status(400).json({ success: false, error: 'Текст отсутствует в запросе' });
    }

    const hasHtml = text.includes('<') && text.includes('>');
    const aiPrompt = hasHtml
      ? `${prompt || 'Улучши этот текст'}. ОБЯЗАТЕЛЬНО сохрани все HTML теги в том же виде. Текст: ${text}`
      : `${prompt || 'Улучши этот текст'}. Текст: ${text}`;

    const aiResult = await geminiProxyService.improveText({ text, prompt: aiPrompt, model });

    let finalText = aiResult
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#+\s+/gm, '')
      .trim();

    if (hasHtml) {
      const originalPCount = (text.match(/<p[^>]*>/g) || []).length;
      if (originalPCount === 1) {
        finalText = `<p>${finalText}</p>`;
      } else if (originalPCount > 1) {
        const sentences = finalText.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim());
        const perP = Math.max(1, Math.ceil(sentences.length / originalPCount));
        const parts = [];
        for (let i = 0; i < sentences.length; i += perP) {
          parts.push(`<p>${sentences.slice(i, i + perP).join(' ').trim()}</p>`);
        }
        finalText = parts.join('');
      } else {
        finalText = `<p>${finalText}</p>`;
      }
    }

    return res.status(200).json({ success: true, text: finalText });
  } catch (error) {
    logger.error('[gemini-routes] Ошибка при улучшении текста:', error);
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
geminiRouter.post('/generate-text', async (req, res) => {
  try {
    const { prompt, model = 'gemini-3-flash-preview' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует запрос для генерации текста'
      });
    }
    
    logger.log(`[gemini-routes] Генерация текста с моделью ${model}`);
    
    const generatedText = await geminiService.generateText(prompt, model);
    
    return res.status(200).json({
      success: true,
      generatedText,
      model
    });
  } catch (error) {
    logger.error('[gemini-routes] Ошибка при генерации текста:', error);
    return res.status(500).json({
      success: false,
      error: `Ошибка при генерации текста: ${(error as Error).message}`
    });
  }
});
