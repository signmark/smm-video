import { Router } from 'express';
import fetch from 'node-fetch';
import log from '../utils/logger';
import { getN8nUrl } from '../utils/n8n-utils';

const router = Router();

// Базовый URL n8n через централизованную функцию
const getN8nBaseUrl = () => getN8nUrl();

// Маршрут для прямой публикации в ВКонтакте через n8n webhook
router.post('/vk', async (req, res) => {
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации в ВКонтакте
    const webhookUrl = `${getN8nBaseUrl()}/webhook/publish-vk`;
    
    log.info(`[VK Webhook] Отправка запроса на публикацию контента ${contentId} в ВКонтакте`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId }),
    });
    
    const result = await response.json();
    
    log.info(`[VK Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[VK Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации в ВКонтакте' });
  }
});

// Маршрут для публикации VK Clips (Shorts/Клипы) через n8n webhook
router.post('/vk-clips', async (req, res) => {
  try {
    const { contentId, videoUrl, title, description } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации клипов в ВКонтакте
    const webhookUrl = `${getN8nBaseUrl()}/webhook/publish-vk-clips`;
    
    log.info(`[VK Clips Webhook] Отправка запроса на публикацию клипа ${contentId} в ВКонтакте`);
    log.info(`[VK Clips Webhook] Видео URL: ${videoUrl || 'из контента'}`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        contentId,
        videoUrl,
        title,
        description,
        type: 'clip' // Указываем тип контента
      }),
    });
    
    const result = await response.json();
    
    log.info(`[VK Clips Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[VK Clips Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации клипа в ВКонтакте' });
  }
});

// Маршрут для публикации VK Stories через n8n webhook
router.post('/vk-stories', async (req, res) => {
  try {
    const { contentId, mediaUrl } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации Stories в ВКонтакте
    const webhookUrl = `${getN8nBaseUrl()}/webhook/publish-vk-stories`;
    
    log.info(`[VK Stories Webhook] Отправка запроса на публикацию Story ${contentId} в ВКонтакте`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        contentId,
        mediaUrl,
        type: 'story'
      }),
    });
    
    const result = await response.json();
    
    log.info(`[VK Stories Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[VK Stories Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации Story в ВКонтакте' });
  }
});

export default router;