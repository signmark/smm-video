import { Router, Request, Response, Express } from 'express';
import axios from 'axios';
import * as logger from './utils/logger';
import { GlobalApiKeysService } from './services/global-api-keys';
import { ApiServiceName } from './services/api-keys';
import { authenticateUser } from './middleware/user-auth';

const router = Router();
// AI-74: Добавлена аутентификация
router.use(authenticateUser);

/**
 * Сервис для работы с Qwen API
 */
class QwenService {
  private apiKey: string;
  private baseURL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
  }

  async improveText({ text, prompt, model = 'qwen-max' }: { text: string; prompt: string; model?: string }): Promise<string> {
    try {
      // Используем международный совместимый с OpenAI API endpoint
      const compatibleURL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
      
      const response = await axios.post(compatibleURL, {
        model: model,
        messages: [
          {
            role: 'user',
            content: `Задача: улучшить предоставленный текст в соответствии с инструкциями.\nИнструкции: ${prompt}\n\nИсходный текст:\n"""\n${text}\n"""\n\nУлучшенный текст:`
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        top_p: 0.9,
        stop: null
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data?.choices?.[0]?.message?.content) {
        let content = response.data.choices[0].message.content.trim();
        
        // Простая и надежная очистка Qwen форматирования
        // Убираем все тройные кавычки
        content = content.replace(/"""/g, '');
        
        // Убираем кавычки в начале и конце
        content = content.replace(/^["'`]+/, '').replace(/["'`]+$/, '');
        
        // Убираем пустые строки в начале и конце
        content = content.replace(/^\s+/, '').replace(/\s+$/, '');
        
        return content.trim();
      }

      throw new Error('Qwen API returned empty response');
    } catch (error: any) {
      console.log('Qwen API Full Error:', error);
      console.log('Qwen API Response status:', error.response?.status);
      console.log('Qwen API Response data:', error.response?.data);
      logger.error('Error calling Qwen API:', error);
      logger.error('Qwen API Error details:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw new Error(`Ошибка при обращении к Qwen API: ${error.response?.data?.error?.message || error.message}`);
    }
  }
}

/**
 * Получает API ключ Qwen из глобального хранилища
 */
async function getQwenApiKey(req: Request): Promise<string | null> {
  try {
    logger.log('[qwen-routes] Getting Qwen API key from Global API Keys collection', 'qwen');
    
    const globalApiKeysService = new GlobalApiKeysService();
    const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.QWEN);
    
    if (apiKey) {
      logger.log(`[qwen-routes] Successfully retrieved Qwen API key from Global API Keys (length: ${apiKey.length})`, 'qwen');
      logger.log(`[qwen-routes] Qwen API key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`, 'qwen');
      return apiKey;
    } else {
      logger.log('[qwen-routes] Qwen API key not found in Global API Keys collection', 'qwen');
    }
    
    return apiKey;
  } catch (error) {
    logger.error('[qwen-routes] Error getting Qwen API key:', error);
    return null;
  }
}

/**
 * Создает экземпляр сервиса Qwen для пользователя
 */
async function getQwenService(req: Request): Promise<QwenService | null> {
  const apiKey = await getQwenApiKey(req);
  
  if (!apiKey) {
    return null;
  }
  
  return new QwenService({ apiKey });
}

/**
 * Маршрут для улучшения текста с помощью Qwen
 * ПУТЬ БЕЗ /api
 */
router.post('/qwen/improve-text', async (req: Request, res: Response) => {
  try {
    const { text, prompt, model } = req.body;
    // AI-74: userId из проверенной сессии
    const userId = (req as any).user?.id as string | undefined;
    
    logger.log(`[qwen-routes] Received improve-text request from user ${userId}`, 'qwen');
    logger.log(`[qwen-routes] Request data: text length=${text?.length}, prompt length=${prompt?.length}, model=${model}`, 'qwen');
    
    if (!text || !prompt) {
      logger.error('[qwen-routes] Missing text or prompt in improve-text request', 'qwen');
      return res.status(400).json({
        success: false,
        error: 'Текст и инструкции обязательны'
      });
    }
    
    logger.log(`[qwen-routes] Getting Qwen service for user ${userId}`, 'qwen');
    const qwenService = await getQwenService(req);
    
    if (!qwenService) {
      logger.error(`[qwen-routes] Qwen API key not configured for user ${userId}`, 'qwen');
      return res.status(400).json({
        success: false,
        error: 'API ключ Qwen не настроен',
        needApiKey: true
      });
    }
    
    logger.log(`[qwen-routes] Qwen service initialized successfully`, 'qwen');
    logger.log(`[qwen-routes] Calling improveText with model ${model || 'default'}`, 'qwen');
    
    const containsHtml = /<[^>]+>/.test(text);
    const htmlSystemNote = containsHtml
      ? `\n\nВАЖНО: входной текст в HTML-формате. Возвращай результат ТОЛЬКО в HTML формате. Сохраняй все HTML-теги и все эмодзи из оригинала. Не добавляй пояснений и обёрток вида \`\`\`html.`
      : `\n\nВАЖНО: Сохраняй все эмодзи. Не добавляй пояснений — возвращай только улучшенный текст.`;
    const fullPrompt = prompt + htmlSystemNote;

    const improvedText = await qwenService.improveText({ text, prompt: fullPrompt, model });
    
    logger.log(`[qwen-routes] Qwen response: ${improvedText.substring(0, 100)}...`, 'qwen');
    
    // Убираем только markdown-обёртки кода (```html ... ```), остальное не трогаем
    let finalText = improvedText
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    logger.log('[qwen-routes] Text improved successfully, returning response', 'qwen');
    return res.json({
      success: true,
      text: finalText
    });
  } catch (error) {
    logger.error('[qwen-routes] Error improving text with Qwen:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Ошибка при улучшении текста'
    });
  }
});

/**
 * Регистрация маршрутов Qwen в Express приложении
 */
export function registerQwenRoutes(app: Express) {
  // Монтируем на /api
  app.use('/api', router);
  console.log('Qwen routes registered at /api');
}

export default router;