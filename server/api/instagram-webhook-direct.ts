import { Router } from 'express';
import fetch from 'node-fetch';
import log from '../utils/logger';
import { getN8nUrl } from '../utils/n8n-utils';

const router = Router();

// Маршрут для прямой публикации в Instagram через n8n webhook
router.post('/instagram', async (req, res) => {
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации в Instagram
    const webhookUrl = getN8nUrl() + '/webhook/publish-instagram';
    
    log.info(`[Instagram Webhook] Отправка запроса на публикацию контента ${contentId} в Instagram`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId }),
    });
    
    const result = await response.json();
    
    log.info(`[Instagram Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[Instagram Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации в Instagram' });
  }
});

export default router;