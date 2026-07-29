import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { authenticateUser } from '../middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from '../services/campaign-access';
import { sanitizeOAuthSecrets } from '../services/oauth-response-sanitizer';

const router = express.Router();
// Авторизация вешается на каждый маршрут, а НЕ через router.use.
//
// Этот роутер смонтирован как app.use('/api', ...), поэтому верхнеуровневый
// router.use(authenticateUser) применялся ко всему /api и служил ещё одним
// незапланированным гейтом — он же отбивал публичные пути (медиа-прокси для
// соцсетей, подписанные ссылки из письма). Явный гейт живёт в
// server/middleware/api-auth-gate.ts.
router.param('campaignId', async (req, res, next, campaignId) => {
  try {
    await authorizeCampaignAccess(campaignId, req.user?.id, req.user?.token || '', req.user?.is_smm_admin === true);
    next();
  } catch (error) {
    if (error instanceof CampaignAccessError) return res.status(error.status).json({ error: error.code });
    next(error);
  }
});

router.get('/campaigns/:campaignId/threads-settings', authenticateUser, async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    const tokenToUse = userToken || process.env.DIRECTUS_STATIC_TOKEN;
    if (!tokenToUse) {
      return res.status(401).json({ success: false, error: 'Токен авторизации не доступен' });
    }

    const response = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      { headers: { Authorization: `Bearer ${tokenToUse}` } }
    );

    const settings = response.data.data.social_media_settings?.threads || null;
    res.json({ success: true, settings: sanitizeOAuthSecrets(settings) });
  } catch (err: any) {
    log('threads-settings', `GET error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/campaigns/:campaignId/threads-settings', authenticateUser, async (req, res) => {
  const { campaignId } = req.params;
  const { appId, appSecret, accessToken, threadsUserId, username, setupCompletedAt } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    const tokenToUse = userToken || process.env.DIRECTUS_STATIC_TOKEN;
    if (!tokenToUse) {
      return res.status(401).json({ success: false, error: 'Токен авторизации не доступен' });
    }

    const campaignRes = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      { headers: { Authorization: `Bearer ${tokenToUse}` } }
    );

    const existing = campaignRes.data.data.social_media_settings || {};
    const threadsSettings = {
      ...existing.threads,
      ...(appId && { appId }),
      ...(appSecret && { appSecret }),
      ...(accessToken && { accessToken }),
      ...(threadsUserId && { threadsUserId }),
      ...(username && { username }),
      setupCompletedAt: setupCompletedAt || new Date().toISOString()
    };

    await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      { social_media_settings: { ...existing, threads: threadsSettings } },
      { headers: { Authorization: `Bearer ${tokenToUse}` } }
    );

    res.json({ success: true, settings: sanitizeOAuthSecrets(threadsSettings) });
  } catch (err: any) {
    log('threads-settings', `PATCH error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
