import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

router.get('/campaigns/:campaignId/threads-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;
    if (!tokenToUse) {
      return res.status(401).json({ success: false, error: 'Токен авторизации не доступен' });
    }

    const response = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      { headers: { Authorization: `Bearer ${tokenToUse}` } }
    );

    const settings = response.data.data.social_media_settings?.threads || null;
    res.json({ success: true, settings });
  } catch (err: any) {
    log('threads-settings', `GET error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/campaigns/:campaignId/threads-settings', async (req, res) => {
  const { campaignId } = req.params;
  const { appId, appSecret, accessToken, threadsUserId, username, setupCompletedAt } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;
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

    res.json({ success: true, settings: threadsSettings });
  } catch (err: any) {
    log('threads-settings', `PATCH error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
