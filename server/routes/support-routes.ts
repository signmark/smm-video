import express, { Request, Response } from 'express';
import { aiSupportService } from '../services/ai-support';
import * as logger from '../utils/logger';
import { nanoid } from 'nanoid';

const router = express.Router();

/**
 * Отправить сообщение в чат поддержки
 * POST /api/support/message
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { message, sessionId: providedSessionId, userId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Сообщение обязательно'
      });
    }

    // Генерируем sessionId если не передан
    const sessionId = providedSessionId || nanoid();

    logger.info(`[support-routes] Processing support message, session: ${sessionId}`);

    // Обрабатываем сообщение через AI
    const result = await aiSupportService.processMessage({
      sessionId,
      message,
      userId
    });

    res.json({
      success: true,
      data: {
        response: result.response,
        sessionId: result.sessionId,
        needsOperator: result.needsOperator,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('[support-routes] Error processing support message:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка обработки сообщения',
      message: (error as Error).message
    });
  }
});

/**
 * Получить историю чата
 * GET /api/support/history/:sessionId
 */
router.get('/history/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId обязателен'
      });
    }

    const history = aiSupportService.getSessionHistory(sessionId);

    res.json({
      success: true,
      data: {
        messages: history,
        sessionId
      }
    });

  } catch (error) {
    logger.error('[support-routes] Error getting chat history:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения истории',
      message: (error as Error).message
    });
  }
});

/**
 * Вызвать оператора (передать в Chatwoot)
 * POST /api/support/request-operator
 */
router.post('/request-operator', async (req: Request, res: Response) => {
  try {
    const { sessionId, userId, userMessage } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId обязателен'
      });
    }

    logger.info(`[support-routes] Operator requested for session: ${sessionId}`);

    // Помечаем сессию как требующую оператора
    aiSupportService.markNeedsOperator(sessionId);

    // Получаем историю для передачи в Chatwoot
    const history = aiSupportService.getSessionHistory(sessionId);

    res.json({
      success: true,
      data: {
        sessionId,
        message: 'Запрос оператора принят. Откроется виджет Chatwoot.',
        history,
        chatwootReady: true
      }
    });

  } catch (error) {
    logger.error('[support-routes] Error requesting operator:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка вызова оператора',
      message: (error as Error).message
    });
  }
});

/**
 * Проверить статус поддержки (healthcheck)
 * GET /api/support/status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        aiSupport: 'online',
        chatwoot: 'available',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('[support-routes] Error checking support status:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка проверки статуса'
    });
  }
});

/**
 * Получить конфигурацию Chatwoot для клиента
 * GET /api/support/chatwoot-config
 * (работает в production, т.к. использует серверные process.env, а не VITE_)
 */
router.get('/chatwoot-config', async (req: Request, res: Response) => {
  try {
    const config = {
      websiteToken: process.env.CHATWOOT_WEBSITE_TOKEN || 'duHkgeW8qG38GXx6pXNhasxR',
      baseUrl: process.env.CHATWOOT_BASE_URL || 'https://smm-support.nplanner.ru'
    };

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    logger.error('[support-routes] Error getting Chatwoot config:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения конфигурации Chatwoot'
    });
  }
});

export default router;
