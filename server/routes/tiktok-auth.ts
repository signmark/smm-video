/**
 * TikTok OAuth2 Authentication Routes
 */

import { Router } from 'express';
import { TikTokOAuth, TikTokConfig } from '../utils/tiktok-oauth';
import { authMiddleware } from '../middleware/auth';
import axios from 'axios';

const router = Router();

// Временное хранилище для OAuth состояний
const oauthStates = new Map<string, { userId: string; campaignId?: string; timestamp: number; clientKey?: string; clientSecret?: string }>();

// Очистка устаревших состояний (старше 10 минут)
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  oauthStates.forEach((value, key) => {
    if (now - value.timestamp > 10 * 60 * 1000) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => oauthStates.delete(key));
}, 60000);

/**
 * Получение конфигурации TikTok — сначала из env vars, потом из Directus
 */
async function getTikTokConfig(): Promise<TikTokConfig | null> {
  // Приоритет 1: переменные среды
  const envClientKey = process.env.TIKTOK_CLIENT_KEY;
  const envClientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (envClientKey && envClientSecret) {
    console.log('[tiktok-auth] Using TikTok config from environment variables');
    return {
      clientKey: envClientKey,
      clientSecret: envClientSecret,
      redirectUri: process.env.TIKTOK_REDIRECT_URI || 'https://smm.omemo.tech/api/tiktok/auth/callback'
    };
  }

  // Приоритет 2: Directus api_keys
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const token = process.env.DIRECTUS_TOKEN;

    const response = await axios.get(`${directusUrl}/items/api_keys`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: {
        'filter[service][_eq]': 'tiktok',
        'filter[is_active][_eq]': true,
        'limit': 1
      }
    });

    const apiKey = response.data?.data?.[0];
    if (!apiKey) {
      console.log('[tiktok-auth] TikTok API key not found in database or env vars');
      return null;
    }

    return {
      clientKey: apiKey.client_id,
      clientSecret: apiKey.client_secret,
      redirectUri: apiKey.redirect_uri || 'https://smm.omemo.tech/api/tiktok/auth/callback'
    };
  } catch (error) {
    console.error('[tiktok-auth] Error fetching TikTok config:', error);
    return null;
  }
}

/**
 * Инициирует OAuth авторизацию TikTok
 */
router.post('/tiktok/auth/start', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    const { campaignId, clientKey: bodyClientKey, clientSecret: bodyClientSecret } = req.body;
    console.log('[tiktok-auth] Starting OAuth for userId:', userId, 'campaignId:', campaignId);

    // Приоритет 0: credentials из тела запроса (из настроек кампании)
    let tiktokConfig: TikTokConfig | null = null;
    if (bodyClientKey && bodyClientSecret) {
      console.log('[tiktok-auth] Using TikTok config from request body (campaign settings)');
      tiktokConfig = {
        clientKey: bodyClientKey,
        clientSecret: bodyClientSecret,
        redirectUri: process.env.TIKTOK_REDIRECT_URI || 'https://smm.omemo.tech/api/tiktok/auth/callback'
      };
    } else {
      tiktokConfig = await getTikTokConfig();
    }

    if (!tiktokConfig) {
      return res.status(500).json({
        error: 'TikTok OAuth не настроен',
        details: 'Введите Client Key и Client Secret в настройках кампании или задайте TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET'
      });
    }

    const tiktokOAuth = new TikTokOAuth(tiktokConfig);

    // Генерируем уникальный state для CSRF защиты
    const stateKey = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    oauthStates.set(stateKey, {
      userId,
      campaignId,
      timestamp: Date.now(),
      clientKey: tiktokConfig.clientKey,
      clientSecret: tiktokConfig.clientSecret
    });

    // Кодируем state в Base64
    const encodedState = Buffer.from(JSON.stringify({
      key: stateKey,
      campaignId
    })).toString('base64');

    const authUrl = tiktokOAuth.getAuthUrl(encodedState);

    res.json({
      success: true,
      authUrl,
      message: 'Перейдите по ссылке для авторизации TikTok'
    });
  } catch (error) {
    console.error('[tiktok-auth] Error starting OAuth:', error);
    res.status(500).json({
      error: 'Ошибка инициации авторизации',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Обработчик POST для проверки callback URL от TikTok Developer Portal (Test event)
 */
router.post('/tiktok/auth/callback', (req, res) => {
  console.log('[tiktok-auth] TikTok POST webhook test received');
  res.status(200).json({ success: true, message: 'TikTok callback URL is active' });
});

/**
 * Обрабатывает callback от TikTok OAuth
 */
router.get('/tiktok/auth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('[tiktok-auth] OAuth error:', error, error_description);
      return res.redirect(`/settings?error=tiktok_auth_failed&message=${encodeURIComponent(String(error_description || error))}`);
    }

    if (!code || !state) {
      return res.redirect('/settings?error=tiktok_missing_params');
    }

    // Декодируем state
    let stateKey: string;
    let campaignId: string | undefined;

    try {
      const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
      stateKey = decodedState.key;
      campaignId = decodedState.campaignId;
    } catch (e) {
      stateKey = state as string;
    }

    const stateData = oauthStates.get(stateKey);
    if (!stateData) {
      console.error('[tiktok-auth] Invalid or expired state:', stateKey);
      return res.redirect('/settings?error=tiktok_invalid_state');
    }

    const userId = stateData.userId;
    const savedClientKey = stateData.clientKey;
    const savedClientSecret = stateData.clientSecret;
    oauthStates.delete(stateKey);

    // Приоритет 0: credentials из state (были переданы при старте OAuth), иначе из env/Directus
    let tiktokConfig: TikTokConfig | null = null;
    if (savedClientKey && savedClientSecret) {
      console.log('[tiktok-auth] Using TikTok config from OAuth state (campaign credentials)');
      tiktokConfig = {
        clientKey: savedClientKey,
        clientSecret: savedClientSecret,
        redirectUri: process.env.TIKTOK_REDIRECT_URI || 'https://smm.omemo.tech/api/tiktok/auth/callback'
      };
    } else {
      tiktokConfig = await getTikTokConfig();
    }
    if (!tiktokConfig) {
      return res.redirect('/settings?error=tiktok_config_missing');
    }

    const tiktokOAuth = new TikTokOAuth(tiktokConfig);
    const tokens = await tiktokOAuth.exchangeCodeForTokens(code as string);

    console.log('[tiktok-auth] Tokens received for user:', userId);

    // Получаем информацию об аккаунте:
    // 1) getCreatorInfo — нужен video.publish scope
    // 2) getUserBasicInfo — нужен только user.info.basic scope
    // 3) fallback — используем open_id из токена
    let accountName = 'TikTok Account';
    let accountUsername = tokens.openId;
    let accountAvatar = '';
    let privacyLevelOptions: string[] = ['SELF_ONLY'];

    try {
      const creatorInfo = await tiktokOAuth.getCreatorInfo(tokens.accessToken);
      accountName = creatorInfo.creatorNickname;
      accountUsername = creatorInfo.creatorUsername;
      accountAvatar = creatorInfo.creatorAvatarUrl;
      privacyLevelOptions = creatorInfo.privacyLevelOptions;
      console.log('[tiktok-auth] Creator info (video.publish):', accountName);
    } catch (creatorErr) {
      console.warn('[tiktok-auth] getCreatorInfo failed (likely no video.publish scope), trying user.info.basic:', (creatorErr as Error).message);
      try {
        const basicInfo = await tiktokOAuth.getUserBasicInfo(tokens.accessToken);
        accountName = basicInfo.displayName;
        accountUsername = basicInfo.displayName;
        accountAvatar = basicInfo.avatarUrl;
        console.log('[tiktok-auth] User basic info:', accountName);
      } catch (basicErr) {
        console.warn('[tiktok-auth] getUserBasicInfo also failed, using open_id as fallback:', (basicErr as Error).message);
      }
    }

    // Сохраняем токены в Directus
    await saveTikTokTokens(userId, campaignId, tokens, {
      creatorNickname: accountName,
      creatorUsername: accountUsername,
      creatorAvatarUrl: accountAvatar
    });

    // Редирект на страницу успеха (popup callback)
    const successUrl = campaignId
      ? `/tiktok-callback?success=true&accountName=${encodeURIComponent(accountName)}&username=${encodeURIComponent(accountUsername)}&campaignId=${campaignId}`
      : `/tiktok-callback?success=true&accountName=${encodeURIComponent(accountName)}&username=${encodeURIComponent(accountUsername)}`;

    res.redirect(successUrl);
  } catch (error) {
    console.error('[tiktok-auth] Callback error:', error);
    res.redirect(`/tiktok-callback?error=true&message=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`);
  }
});

/**
 * Сохраняет токены TikTok в Directus
 */
async function saveTikTokTokens(
  userId: string,
  campaignId: string | undefined,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; openId: string },
  creatorInfo: { creatorNickname: string; creatorUsername: string; creatorAvatarUrl: string }
): Promise<void> {
  const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
  const directusToken = process.env.DIRECTUS_TOKEN;

  const data = {
    user_id: userId,
    campaign_id: campaignId || null,
    platform: 'tiktok',
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    open_id: tokens.openId,
    account_name: creatorInfo.creatorNickname,
    account_username: creatorInfo.creatorUsername,
    account_avatar: creatorInfo.creatorAvatarUrl,
    is_active: true
  };

  // Проверяем существующую запись
  const existingResponse = await axios.get(`${directusUrl}/items/social_accounts`, {
    headers: { 'Authorization': `Bearer ${directusToken}` },
    params: {
      'filter[user_id][_eq]': userId,
      'filter[platform][_eq]': 'tiktok',
      'filter[open_id][_eq]': tokens.openId,
      'limit': 1
    }
  });

  const existing = existingResponse.data?.data?.[0];

  let savedAccountId: string;
  if (existing) {
    await axios.patch(`${directusUrl}/items/social_accounts/${existing.id}`, data, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });
    savedAccountId = existing.id;
    console.log('[tiktok-auth] Updated existing TikTok account:', existing.id);
  } else {
    const created = await axios.post(`${directusUrl}/items/social_accounts`, data, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });
    savedAccountId = created.data?.data?.id;
    console.log('[tiktok-auth] Created new TikTok account for user:', userId, 'id:', savedAccountId);
  }

  // Записываем TikTok в social_media_settings кампании — как все остальные платформы
  if (campaignId) {
    await updateCampaignTikTokSettings(directusUrl, directusToken!, campaignId, {
      connected: true,
      openId: tokens.openId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountName: creatorInfo.creatorNickname,
      accountUsername: creatorInfo.creatorUsername,
      accountAvatar: creatorInfo.creatorAvatarUrl,
      accountId: savedAccountId
    });
  }
}

/**
 * Обновляет social_media_settings.tiktok кампании
 */
async function updateCampaignTikTokSettings(
  directusUrl: string,
  directusToken: string,
  campaignId: string,
  tiktokData: Record<string, any>
): Promise<void> {
  try {
    // Читаем текущие настройки кампании (коллекция user_campaigns)
    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { 'Authorization': `Bearer ${directusToken}` },
      params: { fields: 'id,social_media_settings' }
    });
    const current = campaignResp.data?.data?.social_media_settings || {};
    const updated = { ...current, tiktok: tiktokData };

    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: updated
    }, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });
    console.log('[tiktok-auth] Updated social_media_settings.tiktok for campaign:', campaignId);
  } catch (err) {
    console.error('[tiktok-auth] Failed to update campaign social_media_settings:', (err as any)?.response?.data || err);
  }
}

/**
 * Получает список подключённых TikTok аккаунтов пользователя
 */
router.get('/tiktok/accounts', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const directusToken = process.env.DIRECTUS_TOKEN;

    const response = await axios.get(`${directusUrl}/items/social_accounts`, {
      headers: { 'Authorization': `Bearer ${directusToken}` },
      params: {
        'filter[user_id][_eq]': userId,
        'filter[platform][_eq]': 'tiktok',
        'filter[is_active][_eq]': true,
        'fields': 'id,account_name,account_username,account_avatar,campaign_id'
      }
    });

    res.json({
      success: true,
      accounts: response.data?.data || []
    });
  } catch (error) {
    console.error('[tiktok-auth] Error fetching accounts:', error);
    res.status(500).json({
      error: 'Ошибка получения аккаунтов',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Отключает TikTok аккаунт
 */
router.delete('/tiktok/accounts/:accountId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { accountId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const directusToken = process.env.DIRECTUS_TOKEN;

    // Проверяем что аккаунт принадлежит пользователю
    const checkResponse = await axios.get(`${directusUrl}/items/social_accounts/${accountId}`, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });

    const account = checkResponse.data?.data;
    if (!account || account.user_id !== userId) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    // Деактивируем аккаунт
    await axios.patch(`${directusUrl}/items/social_accounts/${accountId}`, {
      is_active: false
    }, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });

    // Очищаем social_media_settings.tiktok кампании если этот аккаунт был привязан
    if (account.campaign_id) {
      await updateCampaignTikTokSettings(directusUrl, directusToken!, account.campaign_id, {
        connected: false
      });
    }

    res.json({
      success: true,
      message: 'TikTok аккаунт отключён'
    });
  } catch (error) {
    console.error('[tiktok-auth] Error disconnecting account:', error);
    res.status(500).json({
      error: 'Ошибка отключения аккаунта',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Синхронизирует TikTok аккаунт в social_media_settings кампании.
 * Нужно вызвать один раз для аккаунтов, подключённых до добавления этой логики.
 */
router.post('/tiktok/sync-settings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userToken = req.user?.token; // токен пользователя — имеет права на кампании
    const { campaignId } = req.body;

    if (!userId) return res.status(401).json({ error: 'Пользователь не авторизован' });
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    // Читаем social_accounts через токен пользователя — пользователь видит свои записи
    const accountsResp = await axios.get(`${directusUrl}/items/social_accounts`, {
      headers: { 'Authorization': `Bearer ${userToken}` },
      params: {
        'filter[user_id][_eq]': userId,
        'filter[platform][_eq]': 'tiktok',
        'filter[is_active][_eq]': true,
        'sort': '-id',
        'limit': 1
      }
    });

    const account = accountsResp.data?.data?.[0];
    if (!account) {
      return res.json({ success: false, message: 'Нет активных TikTok аккаунтов' });
    }

    // Читаем текущие настройки кампании через токен пользователя (user_campaigns)
    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { 'Authorization': `Bearer ${userToken}` },
      params: { fields: 'id,social_media_settings' }
    });
    const current = campaignResp.data?.data?.social_media_settings || {};
    const updated = {
      ...current,
      tiktok: {
        connected: true,
        openId: account.open_id,
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        accountName: account.account_name,
        accountUsername: account.account_username,
        accountAvatar: account.account_avatar,
        accountId: account.id
      }
    };

    // Обновляем через токен пользователя — у него есть права на свои кампании
    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: updated
    }, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });

    console.log('[tiktok-auth] sync-settings: wrote tiktok to campaign', campaignId);

    // Привязываем аккаунт к кампании если ещё не привязан (через токен пользователя)
    if (!account.campaign_id) {
      try {
        await axios.patch(`${directusUrl}/items/social_accounts/${account.id}`, {
          campaign_id: campaignId
        }, {
          headers: { 'Authorization': `Bearer ${userToken}` }
        });
      } catch (patchErr: any) {
        // Не критично — просто логируем, основное уже сделано
        console.warn('[tiktok-auth] Could not bind campaign_id to social_account:', patchErr?.response?.status);
      }
    }

    res.json({
      success: true,
      message: 'TikTok синхронизирован с кампанией',
      account: {
        id: account.id,
        accountName: account.account_name,
        accountUsername: account.account_username
      }
    });
  } catch (error) {
    console.error('[tiktok-auth] Error syncing settings:', (error as any)?.response?.data || error);
    res.status(500).json({
      error: 'Ошибка синхронизации',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Получает информацию о создателе (для проверки перед публикацией)
 */
router.get('/tiktok/creator-info/:accountId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { accountId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const directusToken = process.env.DIRECTUS_TOKEN;

    // Получаем аккаунт
    const accountResponse = await axios.get(`${directusUrl}/items/social_accounts/${accountId}`, {
      headers: { 'Authorization': `Bearer ${directusToken}` }
    });

    const account = accountResponse.data?.data;
    if (!account || account.user_id !== userId) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    // Проверяем и обновляем токен если нужно
    let accessToken = account.access_token;
    const expiresAt = new Date(account.expires_at);

    if (expiresAt < new Date()) {
      // Токен истёк, обновляем
      const tiktokConfig = await getTikTokConfig();
      if (!tiktokConfig) {
        return res.status(500).json({ error: 'TikTok не настроен' });
      }

      const tiktokOAuth = new TikTokOAuth(tiktokConfig);
      const newTokens = await tiktokOAuth.refreshAccessToken(account.refresh_token);

      // Обновляем в базе
      await axios.patch(`${directusUrl}/items/social_accounts/${accountId}`, {
        access_token: newTokens.accessToken,
        refresh_token: newTokens.refreshToken,
        expires_at: new Date(Date.now() + newTokens.expiresIn * 1000).toISOString()
      }, {
        headers: { 'Authorization': `Bearer ${directusToken}` }
      });

      accessToken = newTokens.accessToken;
    }

    // Получаем информацию о создателе
    const tiktokConfig = await getTikTokConfig();
    if (!tiktokConfig) {
      return res.status(500).json({ error: 'TikTok не настроен' });
    }

    const tiktokOAuth = new TikTokOAuth(tiktokConfig);
    const creatorInfo = await tiktokOAuth.getCreatorInfo(accessToken);

    res.json({
      success: true,
      creatorInfo
    });
  } catch (error) {
    console.error('[tiktok-auth] Error fetching creator info:', error);
    res.status(500).json({
      error: 'Ошибка получения информации',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Тестовая публикация в TikTok (только для авторизованных пользователей)
 * POST /api/tiktok/test-publish
 * Body: { campaignId, videoUrl, caption? }
 */
router.post('/tiktok/test-publish', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });

    const { campaignId, videoUrl, caption } = req.body;
    if (!campaignId || !videoUrl) {
      return res.status(400).json({ error: 'campaignId и videoUrl обязательны' });
    }

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const directusToken = process.env.DIRECTUS_TOKEN;

    // Ищем подключённый TikTok-аккаунт для кампании
    const accountsResp = await axios.get(`${directusUrl}/items/social_accounts`, {
      headers: { Authorization: `Bearer ${directusToken}` },
      params: {
        'filter[campaign_id][_eq]': campaignId,
        'filter[platform][_eq]': 'tiktok',
        'filter[is_active][_eq]': true,
        'limit': 1,
        'fields': 'id,account_name,open_id,access_token,expires_at'
      }
    });

    const account = accountsResp.data?.data?.[0];
    if (!account?.access_token) {
      return res.status(404).json({ error: 'TikTok аккаунт не найден для кампании' });
    }

    console.log(`[tiktok-test] Аккаунт: ${account.account_name}, expires_at: ${account.expires_at}`);

    const { tiktokService } = await import('../services/social-platforms/tiktok-service');
    const result = await tiktokService.publishAndWait({
      accessToken: account.access_token,
      videoUrl,
      caption: caption || 'Test publication from SMM Manager'
    });

    res.json({
      success: result.success,
      account: account.account_name,
      publishId: result.publishId,
      postUrl: result.postUrl,
      error: result.error
    });
  } catch (error) {
    console.error('[tiktok-test] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Ошибка теста',
    });
  }
});

/**
 * TikTok Webhook endpoint — verification (GET) + events (POST)
 * Use this URL in TikTok Developer Portal → Configure → Event subscriptions:
 *   https://smm.omemo.tech/api/tiktok/webhook
 */
router.get('/tiktok/webhook', (req, res) => {
  // TikTok sends challenge param to verify the endpoint
  const challenge = req.query.challenge as string;
  if (challenge) {
    console.log('[tiktok-webhook] Verification challenge received, responding with:', challenge);
    return res.status(200).send(challenge);
  }
  res.status(200).json({ status: 'ok' });
});

router.post('/tiktok/webhook', (req, res) => {
  try {
    const event = req.body;
    console.log('[tiktok-webhook] Event received:', JSON.stringify(event));
    // TikTok sends challenge in POST body for webhook verification
    if (event && event.challenge) {
      console.log('[tiktok-webhook] Challenge handshake:', event.challenge);
      return res.status(200).json({ challenge: event.challenge });
    }
    // Echo back what TikTok sent
    res.status(200).json(event);
  } catch (error) {
    console.error('[tiktok-webhook] Error processing event:', error);
    res.status(200).end();
  }
});

/**
 * POST /tiktok/test-post
 * Тестовый endpoint — проверяет TikTok токен и делает пробный пост
 * Тело: { videoUrl: string, caption?: string }
 */
router.post('/tiktok/test-post', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userToken = req.user?.token;
    const { videoUrl, caption = 'Test post' } = req.body;

    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    if (!videoUrl) return res.status(400).json({ error: 'videoUrl обязателен' });

    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    // Берём TikTok аккаунт через пользовательский токен
    const accountsResp = await axios.get(`${directusUrl}/items/social_accounts`, {
      headers: { 'Authorization': `Bearer ${userToken}` },
      params: {
        'filter[user_id][_eq]': userId,
        'filter[platform][_eq]': 'tiktok',
        'filter[is_active][_eq]': true,
        'sort': '-id',
        'limit': 1
      }
    });

    const account = accountsResp.data?.data?.[0];
    if (!account) {
      return res.json({ success: false, error: 'Нет активного TikTok аккаунта. Переподключите TikTok.' });
    }

    const accessToken = account.access_token;
    console.log(`[tiktok-test] account=${account.account_username}, token starts with: ${accessToken?.substring(0, 20)}...`);

    // Сначала проверим токен через /user/info/
    try {
      const userInfo = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: { fields: 'open_id,display_name,avatar_url' }
      });
      console.log(`[tiktok-test] user/info ok: code=${userInfo.data?.error?.code}, name=${userInfo.data?.data?.user?.display_name}`);
      if (userInfo.data?.error?.code !== 'ok') {
        return res.json({
          success: false,
          step: 'user_info',
          error: `Токен невалиден: ${userInfo.data?.error?.message}. Переподключите TikTok через OAuth.`,
          errorCode: userInfo.data?.error?.code
        });
      }
    } catch (tokenErr: any) {
      return res.json({
        success: false,
        step: 'user_info',
        error: `Токен невалиден (${tokenErr.response?.status}): ${tokenErr.response?.data?.error?.message || tokenErr.message}. Переподключите TikTok.`
      });
    }

    // Токен валиден — пробуем init (FILE_UPLOAD с фейковыми размерами чтобы проверить доступ)
    // Реальный пост через publishAndWait
    const { tiktokService } = await import('../services/social-platforms/tiktok-service');
    const result = await tiktokService.publishAndWait({
      accessToken,
      videoUrl,
      caption,
      privacyLevel: 'SELF_ONLY'
    });

    res.json({
      success: result.success,
      publishId: result.publishId,
      postUrl: result.postUrl,
      error: result.error,
      account: {
        username: account.account_username,
        name: account.account_name
      }
    });
  } catch (error: any) {
    console.error('[tiktok-test] Error:', error?.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
