import { Router } from 'express';
import log from '../utils/logger';

const router = Router();

router.post('/telegram', async (req, res) => {
  const { contentId } = req.body;
  if (!contentId) {
    return res.status(400).json({ error: 'Не указан ID контента' });
  }
  log.info(`[Telegram Webhook Direct] contentId=${contentId} — используйте /api/social/publish/now`);
  return res.status(501).json({
    success: false,
    error: 'Используйте /api/social/publish/now для публикации в Telegram'
  });
});

export default router;
