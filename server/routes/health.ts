import { Router } from 'express';
import axios from 'axios';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';

const healthRouter = Router();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Проверка работоспособности системы и зависимостей
 *     tags: [System]
 */
healthRouter.get('/health', async (req, res) => {
  const startTime = Date.now();
  const results: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // 1. Directus Check
  try {
    await directusCrud.list('user_campaigns', { limit: 1, useAdminToken: true });
    results.services.directus = { status: 'healthy' };
  } catch (err: any) {
    results.status = 'error';
    results.services.directus = { status: 'unhealthy', error: err.message };
  }

  // 2. Beget S3 Check
  try {
    const s3Url = `https://${process.env.BEGET_S3_BUCKET}.s3.ru1.storage.beget.cloud`;
    const s3Res = await axios.head(s3Url, { timeout: 2000 }).catch(() => null);
    results.services.s3 = { status: s3Res ? 'healthy' : 'unreachable' };
  } catch (err) {
    results.services.s3 = { status: 'unhealthy' };
  }


  const duration = Date.now() - startTime;
  results.duration_ms = duration;

  res.status(results.status === 'ok' ? 200 : 503).json(results);
});

export { healthRouter };
