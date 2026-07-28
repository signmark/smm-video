import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { threadsService } from '../services/social-platforms/threads-service';
import { oauthRedirectUri, publicUrl } from '../utils/public-url';

const router = express.Router();

const oauthSessions = new Map<string, any>();

router.post('/threads/auth/start', async (req, res) => {
  try {
    const { appId, appSecret, campaignId, redirectUri } = req.body;

    if (!appId || !appSecret || !campaignId) {
      return res.status(400).json({ success: false, error: 'Требуются: appId, appSecret, campaignId' });
    }

    const host = req.get('host') || '';
    const finalRedirectUri = redirectUri || (() => {
      if (host.includes('replit.dev')) return `https://${host}/api/threads/auth/callback`;
      return oauthRedirectUri('/api/threads/auth/callback');
    })();

    const userToken = req.headers.authorization?.replace('Bearer ', '') || '';

    const state = Math.random().toString(36).substring(2, 15);
    oauthSessions.set(state, { appId, appSecret, redirectUri: finalRedirectUri, campaignId, userToken, timestamp: Date.now() });

    setTimeout(() => oauthSessions.delete(state), 10 * 60 * 1000);

    const scopes = 'threads_basic,threads_content_publish';

    const authUrl = `https://threads.net/oauth/authorize?` +
      `client_id=${appId}&` +
      `redirect_uri=${encodeURIComponent(finalRedirectUri)}&` +
      `scope=${scopes}&` +
      `response_type=code&` +
      `state=${state}`;

    log('threads-oauth', `OAuth запущен для App ID: ${appId}, Campaign: ${campaignId}`);
    log('threads-oauth', `authUrl: ${authUrl}`);
    res.json({ success: true, authUrl, state, redirectUri: finalRedirectUri });
  } catch (err: any) {
    log('threads-oauth', `Ошибка запуска OAuth: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/threads/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Meta validation probe — no params means it's checking the URL is reachable
  if (!code && !state && !error) {
    return res.status(200).send('OK');
  }

  if (error) {
    return res.redirect(`/threads-callback?error=${encodeURIComponent(`Threads отклонил доступ: ${error}`)}`);
  }

  if (!code || !state) {
    return res.redirect(`/threads-callback?error=${encodeURIComponent('Отсутствует код авторизации или state')}`);
  }

  const session = oauthSessions.get(state as string);
  if (!session) {
    return res.redirect(`/threads-callback?error=${encodeURIComponent('Сессия OAuth истекла. Начните авторизацию заново.')}`);
  }
  oauthSessions.delete(state as string);

  try {
    const { appId, appSecret, redirectUri, campaignId, userToken } = session;

    const directusToken = userToken || process.env.DIRECTUS_TOKEN || process.env.ADMIN_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    if (!directusToken) {
      throw new Error('Нет токена для сохранения в Directus');
    }

    const tokenResult = await threadsService.exchangeCodeForToken(
      code as string, appId, appSecret, redirectUri
    );

    const longLivedToken = await threadsService.getLongLivedToken(tokenResult.access_token, appId, appSecret);

    let threadsUserId = tokenResult.user_id || '';
    let username = '';
    try {
      const userInfo = await threadsService.getUserId(longLivedToken);
      threadsUserId = userInfo.id || threadsUserId;
      username = userInfo.username || '';
    } catch (userErr: any) {
      log(`getUserId failed (app review required): ${userErr.response?.data?.error?.message || userErr.message}`, 'threads-oauth');
      if (!threadsUserId) {
        throw new Error('Не удалось получить ID пользователя Threads. Добавьте аккаунт в список Тестировщиков в Meta Developer Portal.');
      }
    }

    const directusUrl = process.env.DIRECTUS_URL;

    const campaignRes = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${directusToken}` }
    });

    const existing = campaignRes.data.data.social_media_settings || {};
    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: {
        ...existing,
        threads: {
          appId,
          appSecret,
          accessToken: longLivedToken,
          threadsUserId,
          username,
          setupCompletedAt: new Date().toISOString()
        }
      }
    }, { headers: { Authorization: `Bearer ${directusToken}` } });

    log('threads-oauth', `OAuth завершён для user ${username} (${threadsUserId}), campaign ${campaignId}`);
    res.redirect(`/threads-callback?success=1&username=${encodeURIComponent(username)}&threadsUserId=${encodeURIComponent(threadsUserId)}`);
  } catch (err: any) {
    log('threads-oauth', `Ошибка callback: ${err.message}`);
    res.redirect(`/threads-callback?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/threads/auth/exchange', async (req, res) => {
  try {
    const { shortToken, appId, appSecret } = req.body;
    if (!shortToken || !appId || !appSecret) {
      return res.status(400).json({ success: false, error: 'Требуются: shortToken, appId, appSecret' });
    }
    const longLivedToken = await threadsService.getLongLivedToken(shortToken, appId, appSecret);
    const { id: threadsUserId, username } = await threadsService.getUserId(longLivedToken);
    res.json({ success: true, accessToken: longLivedToken, threadsUserId, username });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/threads/deauth', (req, res) => {
  res.json({ success: true });
});

router.get('/threads/deauth', (req, res) => {
  res.json({ success: true });
});

router.post('/threads/data-deletion', (req, res) => {
  const confirmationCode = Math.random().toString(36).substring(2, 10);
  res.json({
    url: publicUrl(`/data-deletion-status?code=${confirmationCode}`),
    confirmation_code: confirmationCode
  });
});

export default router;
