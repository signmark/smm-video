import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger';

const router = express.Router();

const VK_APP_ID = process.env.VK_APP_ID || '6121396';
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET || '';

// --- PKCE state store (in-memory, TTL 10 min) ---
interface PendingOAuth {
  campaignId: string;
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
}
const pendingOAuth = new Map<string, PendingOAuth>();

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function getAppBaseUrl(req: express.Request): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const host = req.get('host') || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

// =======================================================
// VK ID OAuth2 v2  (PKCE, refresh_token support)
// =======================================================

/**
 * GET /api/vk/oauth2/start?campaign_id=X&client_id=Y
 * Формирует PKCE и редиректит в VK ID
 */
router.get('/vk/oauth2/start', (req, res) => {
  const { campaign_id, client_id } = req.query as Record<string, string>;
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id обязателен' });
  }

  const effectiveClientId = client_id || VK_APP_ID;
  if (!effectiveClientId) {
    return res.status(400).json({ error: 'client_id обязателен (или настройте VK_APP_ID в env)' });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${getAppBaseUrl(req)}/api/vk/oauth2/callback`;

  pendingOAuth.set(state, { campaignId: campaign_id, clientId: effectiveClientId, codeVerifier, redirectUri });
  setTimeout(() => pendingOAuth.delete(state), 10 * 60 * 1000);

  const authUrl = new URL('https://id.vk.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', effectiveClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'wall groups photos video');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  log(`[VK-OAUTH2] Start → ${authUrl.toString().substring(0, 100)}`, 'vk-oauth');
  res.redirect(authUrl.toString());
});

/**
 * GET /api/vk/oauth2/callback?code=...&state=...&device_id=...
 * Обменивает code на токены и сохраняет в кампанию
 */
router.get('/vk/oauth2/callback', async (req, res) => {
  const { code, state, device_id, error, error_description } = req.query as Record<string, string>;

  if (error) {
    log(`[VK-OAUTH2] Error from VK: ${error} — ${error_description}`, 'vk-oauth', 'error');
    return res.redirect(`/vk-callback?vk_error=${encodeURIComponent(error_description || error)}`);
  }

  const pending = pendingOAuth.get(state);
  if (!pending) {
    return res.redirect('/vk-callback?vk_error=invalid_state');
  }
  pendingOAuth.delete(state);

  try {
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('client_id', pending.clientId);
    params.set('redirect_uri', pending.redirectUri);
    params.set('code_verifier', pending.codeVerifier);
    if (device_id) params.set('device_id', device_id);

    log(`[VK-OAUTH2] Exchanging code for tokens...`, 'vk-oauth');
    const tokenResp = await axios.post('https://id.vk.com/oauth2/auth', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
    const t = tokenResp.data;

    if (!t.access_token) {
      throw new Error('VK не вернул access_token: ' + JSON.stringify(t));
    }

    log(`[VK-OAUTH2] Tokens received, saving to campaign ${pending.campaignId}`, 'vk-oauth');

    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;

    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${pending.campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const existingSettings = campaignResp.data.data.social_media_settings || {};
    const existingVk = existingSettings.vk || {};

    const expiresAt = t.expires_in
      ? new Date(Date.now() + t.expires_in * 1000).toISOString()
      : null;

    const updatedSettings = {
      ...existingSettings,
      vk: {
        ...existingVk,
        token: t.access_token,
        accessToken: t.access_token,
        refreshToken: t.refresh_token || null,
        deviceId: t.device_id || device_id || existingVk.deviceId || null,
        clientId: pending.clientId,
        tokenExpiresAt: expiresAt,
        configured: true,
        authExpired: false,
        setupCompletedAt: new Date().toISOString()
      }
    };

    await axios.patch(`${directusUrl}/items/user_campaigns/${pending.campaignId}`, {
      social_media_settings: updatedSettings
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    log(`[VK-OAUTH2] Tokens saved for campaign ${pending.campaignId}`, 'vk-oauth');

    res.redirect(`/vk-callback?vk_oauth2=success&campaign_id=${pending.campaignId}&has_refresh=${!!t.refresh_token}`);

  } catch (err: any) {
    log(`[VK-OAUTH2] Callback error: ${err.message}`, 'vk-oauth', 'error');
    res.redirect(`/vk-callback?vk_error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /api/vk/oauth2/refresh
 * Body: { campaignId, clientId, refreshToken, deviceId }
 * Обновляет токен и сохраняет обратно в кампанию
 */
router.post('/vk/oauth2/refresh', async (req, res) => {
  const { campaignId, clientId, refreshToken, deviceId } = req.body;
  if (!campaignId || !clientId || !refreshToken) {
    return res.status(400).json({ error: 'campaignId, clientId и refreshToken обязательны' });
  }

  try {
    const { refreshVkToken } = await import('../services/vk-token-refresh');
    const result = await refreshVkToken({ refreshToken, clientId, deviceId });
    if (!result) throw new Error('Не удалось обновить токен VK');

    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;

    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const existingSettings = campaignResp.data.data.social_media_settings || {};
    const existingVk = existingSettings.vk || {};

    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: {
        ...existingSettings,
        vk: {
          ...existingVk,
          token: result.accessToken,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken || refreshToken,
          deviceId: result.deviceId || deviceId,
          tokenExpiresAt: result.expiresIn
            ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
            : null
        }
      }
    }, { headers: { Authorization: `Bearer ${adminToken}` } });

    log(`[VK-OAUTH2] Token refreshed for campaign ${campaignId}`, 'vk-oauth');
    res.json({ success: true, accessToken: result.accessToken });

  } catch (err: any) {
    log(`[VK-OAUTH2] Refresh error: ${err.message}`, 'vk-oauth', 'error');
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// Webhook-приём токенов (needanapp / любой внешний сервис)
// =======================================================

// Разрешённые origins для CORS (браузерные запросы от needanapp)
const ALLOWED_WEBHOOK_ORIGINS = [
  'https://vk.needanapp.ru',
  'https://needanapp.ru',
  'https://vk.com',
];

function setCorsHeaders(req: express.Request, res: express.Response) {
  const origin = req.headers.origin as string | undefined;
  if (origin && ALLOWED_WEBHOOK_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Если origin неизвестен, всё равно разрешаем — это публичный вебхук
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Preflight для браузерных CORS-запросов от needanapp
router.options('/vk/token-webhook/:campaignId', (req, res) => {
  setCorsHeaders(req, res);
  res.status(204).end();
});

// GET — проверка доступности endpoint (needanapp делает GET перед отправкой токена)
router.get('/vk/token-webhook/:campaignId', (req, res) => {
  setCorsHeaders(req, res);
  res.json({ ok: true, endpoint: 'vk-token-webhook', campaignId: req.params.campaignId });
});

/**
 * POST /api/vk/token-webhook/:campaignId
 * Body: { access_token, refresh_token, device_id, client_id }
 *
 * Принимает токены от внешнего сервиса (needanapp и т.п.) и сохраняет
 * в настройки кампании. Сразу выполняет первый refresh, чтобы убедиться
 * что данные рабочие.
 *
 * Поддерживает прямые CORS-запросы из браузера (vk.needanapp.ru),
 * поэтому needanapp можно настроить напрямую на этот URL — без N8N.
 */
router.post('/vk/token-webhook/:campaignId', async (req, res) => {
  // CORS-заголовки ставим сразу — даже при ошибках ответ будет читаем браузером
  setCorsHeaders(req, res);
  const { campaignId } = req.params;
  const {
    access_token, refresh_token, device_id, client_id,
    // поддерживаем и camelCase вариант на случай разных клиентов
    accessToken, refreshToken, deviceId, clientId
  } = req.body;

  const token = access_token || accessToken;
  const rToken = refresh_token || refreshToken;
  const dId = device_id || deviceId;
  const cId = client_id || clientId;

  // Логируем всё что пришло — помогает отладить формат от needanapp и других сервисов
  log(`[VK-WEBHOOK] Получен запрос для кампании ${campaignId}. Поля: access_token=${!!token}, refresh_token=${!!rToken}, device_id=${!!dId}, client_id=${!!cId}. Тело: ${JSON.stringify(Object.keys(req.body))}`, 'vk-oauth');

  if (!token) {
    return res.status(400).json({ error: 'access_token обязателен' });
  }

  try {
    const adminAuthToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;

    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminAuthToken}` }
    });
    const existingSettings = campaignResp.data.data?.social_media_settings || {};
    const existingVk = existingSettings.vk || {};

    // expires_in из входящего запроса
    const incomingExpiresIn: number | undefined =
      req.body.expires_in ? Number(req.body.expires_in) : undefined;
    const tokenExpiresAt: string | null = incomingExpiresIn
      ? new Date(Date.now() + incomingExpiresIn * 1000).toISOString()
      : null;

    // Сохраняем ВСЁ что пришло от needanapp — без попытки refresh.
    // Refresh будет автоматически перед каждой публикацией (в scheduler).
    const vkUpdate: Record<string, any> = {
      ...existingVk,
      token,
      accessToken: token,
      tokenReceivedAt: new Date().toISOString(),
      configured: true
    };
    if (rToken)        vkUpdate.refreshToken  = rToken;
    if (dId)           vkUpdate.deviceId      = dId;
    if (cId)           vkUpdate.clientId      = cId;
    if (tokenExpiresAt) vkUpdate.tokenExpiresAt = tokenExpiresAt;

    log(`[VK-WEBHOOK] Сохраняем: refreshToken=${!!vkUpdate.refreshToken}, deviceId=${!!vkUpdate.deviceId}, clientId=${!!vkUpdate.clientId}`, 'vk-oauth');

    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: {
        ...existingSettings,
        vk: vkUpdate
      }
    }, { headers: { Authorization: `Bearer ${adminAuthToken}` } });

    log(`[VK-WEBHOOK] Токены сохранены для кампании ${campaignId}. Итого полей VK: ${Object.keys(vkUpdate).join(', ')}`, 'vk-oauth');

    // Сразу отвечаем needanapp — рефреш делаем асинхронно чтобы не держать соединение
    res.json({ success: true, message: 'Токены VK сохранены' });

    // Рефреш без device_id → новый токен привязывается к IP нашего сервера
    // Это нужно чтобы серверные вызовы (публикация, загрузка групп) работали без IP-ошибки
    if (rToken && cId) {
      setImmediate(async () => {
        try {
          const { refreshVkToken } = await import('../services/vk-token-refresh');
          log(`[VK-WEBHOOK] Запускаю server-side refresh для ${campaignId} с device_id (токен привяжется к IP сервера)`, 'vk-oauth');
          // device_id передаём — VK требует его при refresh, но IP нового токена = IP запроса (наш сервер)
          const refreshed = await refreshVkToken({ refreshToken: rToken, clientId: cId, deviceId: dId });
          if (refreshed) {
            const refreshedVk: Record<string, any> = {
              ...vkUpdate,
              token: refreshed.accessToken,
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              ...(refreshed.deviceId && { deviceId: refreshed.deviceId }),
              ...(refreshed.expiresIn && { tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() }),
              serverRefreshedAt: new Date().toISOString(), // маркер: рефреш с сервера завершён
            };
            await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`,
              { social_media_settings: { ...existingSettings, vk: refreshedVk } },
              { headers: { Authorization: `Bearer ${adminAuthToken}` } });
            log(`[VK-WEBHOOK] Server-side refresh OK для ${campaignId}. Токен привязан к IP сервера.`, 'vk-oauth');
          } else {
            // Рефреш не удался — ставим маркер чтобы polling не ждал вечно
            const fallbackVk = { ...vkUpdate, serverRefreshedAt: new Date().toISOString() };
            await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`,
              { social_media_settings: { ...existingSettings, vk: fallbackVk } },
              { headers: { Authorization: `Bearer ${adminAuthToken}` } });
            log(`[VK-WEBHOOK] Server-side refresh вернул null — используется исходный токен`, 'vk-oauth', 'warn');
          }
        } catch (e: any) {
          log(`[VK-WEBHOOK] Server-side refresh error: ${e.message}`, 'vk-oauth', 'warn');
        }
      });
    }

  } catch (err: any) {
    log(`[VK-WEBHOOK] Ошибка для кампании ${campaignId}: ${err.message}`, 'vk-oauth', 'error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/vk/token-webhook/:campaignId/status
 * Проверяет, пришли ли токены (для polling из визарда)
 */
router.get('/vk/token-webhook/:campaignId/status', async (req, res) => {
  const { campaignId } = req.params;
  try {
    const adminAuthToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;
    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminAuthToken}` }
    });
    const vk = campaignResp.data.data?.social_media_settings?.vk || {};
    const hasToken = !!(vk.token);
    const serverRefreshDone = !!(vk.serverRefreshedAt);

    // Если токен получен, но рефреш ещё не завершён — проверяем сколько прошло времени.
    // Через 15 сек после получения токена считаем ready в любом случае (рефреш мог упасть).
    let ready = false;
    if (hasToken && serverRefreshDone) {
      ready = true;
    } else if (hasToken && vk.tokenReceivedAt) {
      const elapsed = Date.now() - new Date(vk.tokenReceivedAt).getTime();
      if (elapsed > 15000) ready = true; // fallback: 15 сек прошло
    }

    res.json({
      ready,
      hasToken,
      serverRefreshDone,
      hasRefresh: !!(vk.refreshToken),
      tokenReceivedAt: vk.tokenReceivedAt || null
    });
  } catch (err: any) {
    res.status(500).json({ ready: false, error: err.message });
  }
});

// =======================================================
// Старый VK OAuth flow (oauth.vk.com) — оставлен для совместимости
// =======================================================

router.get('/vk/auth', (req, res) => {
  const { redirect_url, campaign_id } = req.query;
  if (!VK_APP_ID) {
    return res.status(500).json({ success: false, error: 'VK_APP_ID не настроен' });
  }
  const host = req.get('host') || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const callbackUrl = `${protocol}://${host}/api/vk/callback`;
  const state = Buffer.from(JSON.stringify({
    redirect_url: redirect_url || '/',
    campaign_id: campaign_id || null,
    timestamp: Date.now()
  })).toString('base64');
  const scope = 'wall,photos,video,groups,offline';
  const authUrl = `https://oauth.vk.com/authorize?client_id=${VK_APP_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&response_type=code&v=5.131&state=${state}`;
  res.redirect(authUrl);
});

router.get('/vk/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.redirect(`/?vk_error=${encodeURIComponent(String(error_description || error))}`);
  if (!code) return res.redirect('/?vk_error=no_code');
  if (!VK_APP_ID || !VK_CLIENT_SECRET) return res.redirect('/?vk_error=server_config');

  try {
    const host = req.get('host') || '';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const callbackUrl = `${protocol}://${host}/api/vk/callback`;
    const tokenResponse = await axios.get('https://oauth.vk.com/access_token', {
      params: { client_id: VK_APP_ID, client_secret: VK_CLIENT_SECRET, redirect_uri: callbackUrl, code }
    });
    const { access_token, user_id, expires_in } = tokenResponse.data;
    if (!access_token) return res.redirect('/?vk_error=no_token');

    let redirectUrl = '/';
    let campaignId: string | null = null;
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(String(state), 'base64').toString());
        redirectUrl = stateData.redirect_url || '/';
        campaignId = stateData.campaign_id || null;
      } catch {}
    }

    // Если указана кампания — сохраняем токен прямо в неё (offline = не истекает)
    if (campaignId) {
      try {
        const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
        const directusUrl = process.env.DIRECTUS_URL;
        const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        const existingSettings = campaignResp.data.data?.social_media_settings || {};
        const existingVk = existingSettings.vk || {};

        await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
          social_media_settings: {
            ...existingSettings,
            vk: {
              ...existingVk,
              token: access_token,
              accessToken: access_token,
              // offline токен не истекает — убираем refreshToken чтобы не путать крон
              refreshToken: null,
              clientId: VK_APP_ID,
              tokenExpiresAt: null, // offline = вечный
              tokenReceivedAt: new Date().toISOString(),
              configured: true,
              setupCompletedAt: new Date().toISOString()
            }
          }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });

        log(`[VK-CALLBACK] Offline-токен сохранён для кампании ${campaignId}`, 'vk-oauth');
        return res.redirect(`/campaigns/${campaignId}/settings?vk_connected=1`);
      } catch (saveErr: any) {
        log(`[VK-CALLBACK] Ошибка сохранения токена: ${saveErr.message}`, 'vk-oauth', 'error');
      }
    }

    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.redirect(`${redirectUrl}${separator}vk_token=${access_token}&vk_user_id=${user_id}`);
  } catch (err: any) {
    res.redirect(`/?vk_error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/vk/auth-url', (req, res) => {
  if (!VK_APP_ID) return res.status(500).json({ success: false, error: 'VK_APP_ID не настроен' });
  const host = req.get('host') || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const callbackUrl = `${protocol}://${host}/api/vk/callback`;
  const state = Buffer.from(JSON.stringify({ redirect_url: req.query.redirect_url || '/', timestamp: Date.now() })).toString('base64');
  const authUrl = `https://oauth.vk.com/authorize?client_id=${VK_APP_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=wall,photos,video,groups,offline&response_type=code&v=5.131&state=${state}`;
  res.json({ success: true, authUrl, appId: VK_APP_ID });
});

router.get('/vk/groups', async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ success: false, error: 'Access token не предоставлен' });

  const token = String(access_token);
  const isV2 = token.startsWith('vk2.');

  // vk2.a.xxx токены: Authorization: Bearer + v=5.199
  // Старые токены: access_token query param + v=5.131
  const makeParams = (withFilter: boolean) => {
    const p: Record<string, any> = {
      extended: 1,
      fields: 'name,screen_name,members_count,description,photo_200',
      v: isV2 ? '5.199' : '5.131',
    };
    if (!isV2) p.access_token = token;
    if (withFilter) p.filter = 'admin,editor,moder';
    return p;
  };
  const headers = isV2 ? { Authorization: `Bearer ${token}` } : {};

  log(`[VK-GROUPS] Запрос групп (тип: ${isV2 ? 'vk2/Bearer' : 'old/query'})`, 'vk-oauth');

  const callApi = async (withFilter: boolean) => {
    const r = await axios.get('https://api.vk.com/method/groups.get', {
      params: makeParams(withFilter), headers, timeout: 10000
    });
    return r.data;
  };

  try {
    let data = await callApi(true);

    // Если с фильтром ошибка — пробуем без
    if (data.error) {
      log(`[VK-GROUPS] С фильтром ошибка: ${data.error.error_code} ${data.error.error_msg} — пробую без фильтра`, 'vk-oauth', 'warn');
      data = await callApi(false);
    }

    if (data.error) {
      const e = data.error;
      log(`[VK-GROUPS] Ошибка VK API: ${e.error_code} ${e.error_msg}`, 'vk-oauth', 'error');
      return res.status(500).json({ success: false, error: e.error_msg || `VK error ${e.error_code}`, code: e.error_code });
    }

    const groups = data.response?.items || [];
    log(`[VK-GROUPS] Получено ${groups.length} групп`, 'vk-oauth');
    res.json({
      success: true,
      groups: groups.map((g: any) => ({
        id: `-${g.id}`,
        name: g.name,
        screen_name: g.screen_name,
        members_count: g.members_count || 0,
        description: g.description || '',
        photo: g.photo_200 || ''
      }))
    });
  } catch (err: any) {
    log(`[VK-GROUPS] Исключение: ${err.message}`, 'vk-oauth', 'error');
    res.status(500).json({ success: false, error: 'Ошибка получения списка VK групп', details: err.message });
  }
});

router.get('/vk/validate', async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ success: false, error: 'Access token не предоставлен' });
  try {
    const r = await axios.get('https://api.vk.com/method/users.get', { params: { access_token, v: '5.131' } });
    if (r.data.error) throw new Error(r.data.error.error_msg || 'Invalid token');
    const user = r.data.response?.[0];
    res.json({ success: true, valid: true, user: { id: user?.id, first_name: user?.first_name, last_name: user?.last_name } });
  } catch (err: any) {
    res.json({ success: false, valid: false, error: err.message });
  }
});

export default router;
