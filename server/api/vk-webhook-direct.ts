import { Router } from 'express';
import log from '../utils/logger';

const router = Router();

router.post('/vk', async (req, res) => {
  const { contentId } = req.body;
  if (!contentId) {
    return res.status(400).json({ error: 'Не указан ID контента' });
  }
  log.info(`[VK Webhook Direct] contentId=${contentId} — используйте /api/social/publish/now`);
  return res.status(501).json({
    success: false,
    error: 'Используйте /api/social/publish/now для публикации в ВКонтакте'
  });
});

router.post('/vk-clips', async (req, res) => {
  const { contentId } = req.body;
  if (!contentId) {
    return res.status(400).json({ error: 'Не указан ID контента' });
  }
  log.info(`[VK Clips Webhook Direct] contentId=${contentId} — используйте /api/social/publish/now`);
  return res.status(501).json({
    success: false,
    error: 'Используйте /api/social/publish/now для публикации клипов в ВКонтакте'
  });
});

router.post('/vk-stories', async (req, res) => {
  const { contentId } = req.body;
  if (!contentId) {
    return res.status(400).json({ error: 'Не указан ID контента' });
  }
  log.info(`[VK Stories Webhook Direct] contentId=${contentId} — используйте /api/social/publish/now`);
  return res.status(501).json({
    success: false,
    error: 'Используйте /api/social/publish/now для публикации Stories в ВКонтакте'
  });
});

export default router;
