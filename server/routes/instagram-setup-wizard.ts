import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { GlobalApiKeysService } from '../services/global-api-keys';
import { directusApiManager } from '../directus';

const router = express.Router();

// Временное хранение для OAuth flow (в продакшене использовать Redis)
const oauthSessions = new Map();

// Конфигурация для Instagram OAuth (полные разрешения для постинга)
const INSTAGRAM_SCOPES = [
  'pages_show_list',
  'ads_management',
  'business_management',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_content_publish',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_posts'
];

const AXIOS_CONFIG = {
  timeout: 30000,
  headers: {
    'User-Agent': 'SMM-Manager/1.0 (https://nplanner.ru)'
  }
};

/**
 * Сохранение конфигурации Instagram для N8N workflow
 */
router.post('/save-config', async (req, res) => {
  try {
    console.log('🔥🔥🔥 INSTAGRAM SETUP SAVE CONFIG START 🔥🔥🔥');
    console.log('🔥 Instagram Setup Save Config - BODY fields:', Object.keys(req.body || {}));
    console.log('🔥 Instagram Setup Save Config - Content-Type:', req.headers['content-type']);
    console.log('🔥 Instagram Setup Save Config - Header keys:', Object.keys(req.headers), '| hasAuthorization:', !!req.headers['authorization']);
    
    const { appId, appSecret, instagramId, userId, state } = req.body;
    const webhookUrl = process.env.INSTAGRAM_WEBHOOK_URL || '';
    
    console.log('🔥 Extracted data:', { appId, hasAppSecret: !!appSecret, instagramId, userId, state });

    if (!appId || !appSecret || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: appId, appSecret, userId'
      });
    }

    // Сохраняем конфигурацию в глобальные API ключи для доступа из N8N
    const configData = {
      userId,
      appId,
      appSecret,
      webhookUrl,
      instagramId,
      state,
      createdAt: new Date(),
      status: 'pending_auth',
      scopes: [
        'pages_show_list',
        'ads_management',
        'business_management',
        'pages_messaging',
        'instagram_basic',
        'instagram_manage_insights',
        'instagram_content_publish',
        'pages_read_engagement',
        'pages_manage_metadata',
        'pages_manage_posts'
      ].join(',')
    };

    // Сохраняем конфигурацию в память (для демо)
    oauthSessions.set(state, configData);
    log(`Instagram config saved to memory store for user ${userId}`, 'instagram-setup');

    res.json({
      success: true,
      message: 'Конфигурация сохранена',
      state: state
    });

  } catch (error) {
    log(`Error saving Instagram config: ${error.message}`, 'instagram-setup');
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при сохранении конфигурации',
      details: error.message
    });
  }
});

/**
 * Проверка статуса Instagram подключения 
 */
router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    log(`Checking Instagram status for user: ${userId}`, 'instagram-setup');
    
    // Проверяем сохраненные конфигурации в памяти
    const userConfigs = Array.from(oauthSessions.entries()).filter(([key, value]) => 
      key.startsWith(`${userId}_`) && value.status === 'active'
    );
    
    if (userConfigs.length > 0) {
      const [state, data] = userConfigs[0];
      return res.json({
        success: true,
        connected: true,
        data: {
          appId: data.appId,
          status: data.status,
          setupCompletedAt: data.createdAt,
          hasAccessToken: !!data.accessToken
        }
      });
    }
    
    return res.json({
      success: true,
      connected: false
    });

  } catch (error) {
    log(`Error checking Instagram status: ${error.message}`, 'instagram-setup');
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при проверке статуса Instagram',
      details: error.message
    });
  }
});

/**
 * Начало OAuth flow для Instagram (DEPRECATED - используется N8N)
 */
router.post('/start', async (req, res) => {
  try {
    console.log('🔥 Instagram Setup Start Route - BODY fields:', Object.keys(req.body || {}));
    console.log('🔥 Instagram Setup Start Route - Content-Type:', req.headers['content-type']);
    
    const { appId, appSecret, redirectUri, webhookUrl, instagramId, userId } = req.body;

    if (!appId || !appSecret || !redirectUri || !userId) {
      return res.status(400).json({
        error: 'Требуются: appId, appSecret, redirectUri, userId'
      });
    }

    // Используем webhook URL из конфигурации
    const finalWebhookUrl = webhookUrl || process.env.INSTAGRAM_WEBHOOK_URL || '';

    // Генерируем уникальный state для безопасности
    const state = `${userId}_${Math.random().toString(36).substring(2, 15)}`;

    // Сохраняем данные сессии
    oauthSessions.set(state, {
      appId,
      appSecret,
      redirectUri,
      webhookUrl: finalWebhookUrl,
      instagramId,
      userId,
      timestamp: Date.now()
    });

    // Формируем URL для авторизации Facebook
    const authUrl = `https://www.facebook.com/v23.0/dialog/oauth?` +
      `client_id=${appId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(INSTAGRAM_SCOPES.join(','))}&` +
      `response_type=code&` +
      `state=${state}`;

    log(`Instagram OAuth started for user ${userId}`, 'instagram-setup');
    
    res.json({ 
      success: true,
      authUrl, 
      state,
      message: 'Перенаправьте пользователя на authUrl для авторизации Facebook'
    });

  } catch (error) {
    log(`Error starting Instagram OAuth: ${error.message}`, 'instagram-setup');
    res.status(500).json({ error: 'Ошибка инициализации OAuth' });
  }
});

/**
 * Callback для обработки ответа от Facebook
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      log(`Facebook OAuth error: ${error}`, 'instagram-setup');
      return res.status(400).json({ error: `Facebook error: ${error}` });
    }

    if (!code || !state) {
      return res.status(400).json({ error: 'Отсутствует код авторизации или state' });
    }

    // Получаем данные сессии
    const session = oauthSessions.get(state);
    if (!session) {
      return res.status(400).json({ error: 'Недействительная сессия или сессия истекла' });
    }

    // Удаляем сессию после использования
    oauthSessions.delete(state);

    log('Начинаем обработку Instagram OAuth callback', 'instagram-setup');

    // Шаг 1: Получаем краткосрочный токен
    const tokenResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        client_id: session.appId,
        client_secret: session.appSecret,
        redirect_uri: session.redirectUri,
        code: code
      },
      ...AXIOS_CONFIG
    });

    const shortLivedToken = tokenResponse.data.access_token;
    log('Получен краткосрочный токен', 'instagram-setup');

    // Шаг 2: Обмениваем на долгосрочный токен
    const longLivedResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: session.appId,
        client_secret: session.appSecret,
        fb_exchange_token: shortLivedToken
      },
      ...AXIOS_CONFIG
    });

    const longLivedToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in;
    log('Получен долгосрочный токен', 'instagram-setup');

    // Шаг 3: Получаем информацию о пользователе
    const userResponse = await axios.get('https://graph.facebook.com/v23.0/me', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,email'
      },
      ...AXIOS_CONFIG
    });

    // Шаг 4: Получаем страницы с Instagram аккаунтами
    const pagesResponse = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}',
        limit: 100
      },
      ...AXIOS_CONFIG
    });

    // Фильтруем только страницы с подключенным Instagram
    const pagesWithInstagram = pagesResponse.data.data?.filter(page => 
      page.instagram_business_account
    ) || [];

    log(`Найдено ${pagesWithInstagram.length} страниц с Instagram`, 'instagram-setup');

    // Формируем данные для Instagram аккаунтов
    const instagramAccounts = pagesWithInstagram.map(page => ({
      instagramId: page.instagram_business_account.id,
      username: page.instagram_business_account.username,
      name: page.instagram_business_account.name,
      profilePicture: page.instagram_business_account.profile_picture_url,
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token
    }));

    // Подготавливаем данные для сохранения
    const instagramData = {
      userId: session.userId,
      appId: session.appId,
      appSecret: session.appSecret, // В продакшене шифровать
      userAccessToken: longLivedToken,
      tokenExpiresIn: expiresIn,
      tokenExpiresAt: new Date(Date.now() + (expiresIn * 1000)),
      facebookUser: userResponse.data,
      instagramAccounts: instagramAccounts,
      webhookUrl: session.webhookUrl,
      setupCompletedAt: new Date(),
      status: 'active'
    };

    // Сохраняем в Directus
    try {
      await directusApiManager.createItem('instagram_credentials', instagramData);
      log(`Instagram credentials saved for user ${session.userId}`, 'instagram-setup');
    } catch (dbError) {
      log(`Error saving Instagram credentials: ${dbError.message}`, 'instagram-setup');
      // Продолжаем выполнение, но логируем ошибку
    }

    // Отправляем успешный ответ
    res.json({
      success: true,
      message: 'Instagram успешно подключен!',
      data: {
        facebookUser: userResponse.data,
        instagramAccounts: instagramAccounts,
        tokenExpiresAt: instagramData.tokenExpiresAt,
        setupCompletedAt: instagramData.setupCompletedAt
      }
    });

  } catch (error) {
    log(`Error in Instagram OAuth callback: ${error.message}`, 'instagram-setup');
    
    if (error.response?.data) {
      log(`Facebook API error: ${JSON.stringify(error.response.data)}`, 'instagram-setup');
    }
    
    res.status(500).json({ 
      error: 'Ошибка при обработке авторизации',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST Callback для обработки кода из формы
 */
router.post('/callback', async (req, res) => {
  try {
    const { code, state, userId } = req.body;

    if (!code || !state) {
      return res.status(400).json({ 
        success: false,
        error: 'Отсутствует код авторизации или state' 
      });
    }

    // Получаем данные сессии
    const session = oauthSessions.get(state);
    if (!session) {
      return res.status(400).json({ 
        success: false,
        error: 'Недействительная сессия или сессия истекла. Попробуйте начать процесс заново.' 
      });
    }

    // Проверяем, что userId совпадает
    if (session.userId !== userId) {
      return res.status(400).json({
        success: false,
        error: 'Неверный пользователь для данной сессии'
      });
    }

    // Удаляем сессию после использования
    oauthSessions.delete(state);

    log(`Processing Instagram OAuth callback for user ${userId}`, 'instagram-setup');

    // Используем тот же код обработки что и в GET callback
    // Шаг 1: Получаем краткосрочный токен
    const tokenResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        client_id: session.appId,
        client_secret: session.appSecret,
        redirect_uri: session.redirectUri,
        code: code
      },
      ...AXIOS_CONFIG
    });

    const shortLivedToken = tokenResponse.data.access_token;
    log('Получен краткосрочный токен', 'instagram-setup');

    // Шаг 2: Обмениваем на долгосрочный токен
    const longLivedResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: session.appId,
        client_secret: session.appSecret,
        fb_exchange_token: shortLivedToken
      },
      ...AXIOS_CONFIG
    });

    const longLivedToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in;
    log('Получен долгосрочный токен', 'instagram-setup');

    // Шаг 3: Получаем информацию о пользователе
    const userResponse = await axios.get('https://graph.facebook.com/v23.0/me', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,email'
      },
      ...AXIOS_CONFIG
    });

    // Шаг 4: Получаем страницы с Instagram аккаунтами
    const pagesResponse = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}',
        limit: 100
      },
      ...AXIOS_CONFIG
    });

    // Фильтруем только страницы с подключенным Instagram
    const pagesWithInstagram = pagesResponse.data.data.filter(page =>
      page.instagram_business_account
    );

    log(`Found ${pagesWithInstagram.length} pages with Instagram accounts`, 'instagram-setup');

    // Обрабатываем Instagram аккаунты
    const instagramAccounts = pagesWithInstagram.map(page => ({
      instagramId: page.instagram_business_account.id,
      username: page.instagram_business_account.username,
      name: page.instagram_business_account.name,
      profilePicture: page.instagram_business_account.profile_picture_url,
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token
    }));

    // Подготавливаем данные для сохранения
    const instagramData = {
      userId: session.userId,
      appId: session.appId,
      appSecret: session.appSecret,
      userAccessToken: longLivedToken,
      tokenExpiresIn: expiresIn,
      tokenExpiresAt: new Date(Date.now() + (expiresIn * 1000)),
      facebookUser: userResponse.data,
      instagramAccounts: instagramAccounts,
      webhookUrl: session.webhookUrl,
      setupCompletedAt: new Date(),
      status: 'active'
    };

    // Сохраняем в Directus
    try {
      await directusApiManager.createItem('instagram_credentials', instagramData);
      log(`Instagram credentials saved for user ${session.userId}`, 'instagram-setup');
    } catch (dbError) {
      log(`Error saving Instagram credentials: ${dbError.message}`, 'instagram-setup');
    }

    // Отправляем успешный ответ
    res.json({
      success: true,
      message: 'Instagram успешно подключен!',
      data: {
        connected: true,
        facebookUser: userResponse.data,
        instagramAccounts: instagramAccounts,
        tokenExpiresAt: instagramData.tokenExpiresAt,
        setupCompletedAt: instagramData.setupCompletedAt
      }
    });

  } catch (error) {
    log(`Error in Instagram OAuth POST callback: ${error.message}`, 'instagram-setup');
    
    if (error.response?.data) {
      log(`Facebook API error: ${JSON.stringify(error.response.data)}`, 'instagram-setup');
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при обработке авторизации',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Получение статуса подключения Instagram для пользователя
 */
router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const credentials = await directusApiManager.getItems('instagram_credentials', {
      filter: { user_id: { _eq: userId } },
      limit: 1
    });

    if (!credentials.data || credentials.data.length === 0) {
      return res.json({
        connected: false,
        message: 'Instagram не подключен'
      });
    }

    const cred = credentials.data[0];
    const isExpired = new Date() > new Date(cred.token_expires_at);

    res.json({
      connected: true,
      expired: isExpired,
      instagramAccounts: cred.instagram_accounts || [],
      setupCompletedAt: cred.setup_completed_at,
      tokenExpiresAt: cred.token_expires_at
    });

  } catch (error) {
    log(`Error getting Instagram status: ${error.message}`, 'instagram-setup');
    res.status(500).json({ error: 'Ошибка получения статуса' });
  }
});

/**
 * Удаление подключения Instagram
 */
router.delete('/disconnect/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    await directusApiManager.deleteItems('instagram_credentials', {
      filter: { user_id: { _eq: userId } }
    });

    log(`Instagram disconnected for user ${userId}`, 'instagram-setup');
    
    res.json({
      success: true,
      message: 'Instagram отключен'
    });

  } catch (error) {
    log(`Error disconnecting Instagram: ${error.message}`, 'instagram-setup');
    res.status(500).json({ error: 'Ошибка отключения Instagram' });
  }
});

/**
 * Обновление токена Instagram (если истек)
 */
router.post('/refresh-token/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const credentials = await directusApiManager.getItems('instagram_credentials', {
      filter: { user_id: { _eq: userId } },
      limit: 1
    });

    if (!credentials.data || credentials.data.length === 0) {
      return res.status(404).json({ error: 'Instagram credentials not found' });
    }

    const cred = credentials.data[0];

    // Обновляем долгосрочный токен
    const refreshResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: cred.app_id,
        client_secret: cred.app_secret,
        fb_exchange_token: cred.user_access_token
      },
      ...AXIOS_CONFIG
    });

    const newToken = refreshResponse.data.access_token;
    const newExpiresIn = refreshResponse.data.expires_in;

    // Обновляем в базе
    await directusApiManager.updateItem('instagram_credentials', cred.id, {
      user_access_token: newToken,
      token_expires_in: newExpiresIn,
      token_expires_at: new Date(Date.now() + (newExpiresIn * 1000)),
      token_refreshed_at: new Date()
    });

    log(`Instagram token refreshed for user ${userId}`, 'instagram-setup');

    res.json({
      success: true,
      message: 'Токен обновлен',
      tokenExpiresAt: new Date(Date.now() + (newExpiresIn * 1000))
    });

  } catch (error) {
    log(`Error refreshing Instagram token: ${error.message}`, 'instagram-setup');
    res.status(500).json({ error: 'Ошибка обновления токена' });
  }
});

// Очистка истекших сессий (запускать периодически)
setInterval(() => {
  const now = Date.now();
  const expiredSessions = [];

  for (const [state, session] of oauthSessions.entries()) {
    if (now - session.timestamp > 30 * 60 * 1000) { // 30 минут
      expiredSessions.push(state);
    }
  }

  expiredSessions.forEach(state => {
    oauthSessions.delete(state);
  });

  if (expiredSessions.length > 0) {
    log(`Cleaned up ${expiredSessions.length} expired OAuth sessions`, 'instagram-setup');
  }
}, 10 * 60 * 1000); // Каждые 10 минут

export default router;
