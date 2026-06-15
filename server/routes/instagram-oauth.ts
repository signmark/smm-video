import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

// Временное хранение для OAuth flow (в продакшене можно использовать Redis)
const oauthSessions = new Map();

// Эндпоинт для начала OAuth flow
router.post('/instagram/auth/start', async (req, res) => {
  try {
    const { appId, appSecret, redirectUri, webhookUrl, instagramId, campaignId } = req.body;

    if (!appId || !appSecret || !campaignId) {
      return res.status(400).json({
        success: false,
        error: 'Требуются: appId, appSecret, campaignId'
      });
    }

    // Определяем правильный redirect URI в зависимости от окружения
    let finalRedirectUri = redirectUri;
    if (!finalRedirectUri) {
      const host = req.get('host');
      if (host && host.includes('replit.dev')) {
        // В Replit разработке используем текущий домен
        finalRedirectUri = `${req.protocol}://${host}/instagram-callback`;
      } else {
        // В продакшене используем фиксированный домен
        finalRedirectUri = 'https://smm.omemo.tech/instagram-callback';
      }
    }

    const finalWebhookUrl = webhookUrl || process.env.INSTAGRAM_WEBHOOK_URL || '';

    // Генерируем уникальный state для безопасности
    const state = Math.random().toString(36).substring(2, 15);

    // Сохраняем данные сессии
    oauthSessions.set(state, {
      appId,
      appSecret,
      redirectUri: finalRedirectUri,
      webhookUrl: finalWebhookUrl,
      instagramId,
      campaignId, // Добавляем campaignId для последующего сохранения
      timestamp: Date.now()
    });

    // Формируем URL для авторизации Facebook с полными разрешениями для постинга
    const scopes = [
      'pages_show_list',               // Список Facebook страниц
      'ads_management',                // Управление рекламой
      'business_management',           // Управление бизнесом
      'pages_messaging',               // Сообщения страниц
      'instagram_basic',               // Базовые Instagram разрешения
      'instagram_manage_insights',     // Аналитика Instagram
      'instagram_content_publish',     // Публикация в Instagram
      'pages_read_engagement',         // Чтение взаимодействий на страницах
      'pages_manage_metadata',         // Управление метаданными страниц
      'pages_manage_posts'             // Управление постами страниц
    ].join(',');

    const authUrl = `https://www.facebook.com/v23.0/dialog/oauth?` +
      `client_id=${appId}&` +
      `redirect_uri=${encodeURIComponent(finalRedirectUri)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `response_type=code&` +
      `auth_type=rerequest&` +
      `state=${state}`;

    log('instagram-oauth', `OAuth поток запущен для App ID: ${appId}, Campaign ID: ${campaignId}`);
    log('instagram-oauth', `Redirect URI: ${finalRedirectUri}`);
    log('instagram-oauth', `Auth URL: ${authUrl}`);
    
    res.json({ 
      success: true,
      authUrl, 
      state,
      redirectUri: finalRedirectUri
    });
  } catch (error) {
    log('instagram-oauth', `Ошибка запуска OAuth: ${error}`);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при запуске OAuth' 
    });
  }
});

// Callback эндпоинт для обработки ответа от Facebook
router.get('/instagram/auth/callback', async (req, res) => {
  console.log('🚀 INSTAGRAM OAUTH CALLBACK STARTED');
  console.log('📋 Query parameters:', JSON.stringify(req.query, null, 2));
  
  const { code, state, error } = req.query;

  if (error) {
    console.log('❌ Facebook OAuth error:', error);
    log('instagram-oauth', `Facebook error: ${error}`);
    return res.status(400).json({ error: `Facebook error: ${error}` });
  }

  if (!code || !state) {
    console.log('❌ Missing required parameters - code or state');
    return res.status(400).json({ error: 'Отсутствует код авторизации или state' });
  }

  console.log('✅ OAuth code received:', code?.toString().substring(0, 20) + '...');
  console.log('✅ State parameter:', state);

  // Получаем данные сессии
  const session = oauthSessions.get(state);
  if (!session) {
    console.log('❌ Invalid session for state:', state);
    console.log('📋 Available sessions:', Array.from(oauthSessions.keys()));
    return res.status(400).json({ error: 'Недействительная сессия' });
  }

  console.log('✅ Session found:', {
    appId: session.appId,
    campaignId: session.campaignId,
    instagramId: session.instagramId,
    timestamp: new Date(session.timestamp).toISOString()
  });

  try {
    // Настройки для axios с увеличенным timeout
    const axiosConfig = {
      timeout: 30000, // 30 секунд
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    log('instagram-oauth', 'Шаг 1: Получаем краткосрочный токен...');
    console.log('📋 Token exchange params:', {
      client_id: session.appId,
      client_secret: session.appSecret?.substring(0, 10) + '...',
      redirect_uri: session.redirectUri,
      code: code?.toString().substring(0, 30) + '...'
    });
    
    // Шаг 1: Обмениваем код на краткосрочный токен
    let tokenResponse;
    try {
      tokenResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
        params: {
          client_id: session.appId,
          client_secret: session.appSecret,  
          redirect_uri: session.redirectUri,
          code: code
        },
        ...axiosConfig
      });
    } catch (tokenError: any) {
      console.log('❌ Token exchange error:', tokenError.response?.data || tokenError.message);
      log('instagram-oauth', `Token exchange error: ${JSON.stringify(tokenError.response?.data)}`);
      throw tokenError;
    }

    const shortLivedToken = tokenResponse.data.access_token;
    console.log('✅ Short-lived token received:', shortLivedToken.substring(0, 20) + '...');

    log('instagram-oauth', 'Шаг 2: Получаем долгосрочный токен...');
    console.log('🔄 Converting to long-lived token...');
    // Шаг 2: Обмениваем краткосрочный токен на долгосрочный
    const longLivedResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: session.appId,
        client_secret: session.appSecret,
        fb_exchange_token: shortLivedToken
      },
      ...axiosConfig
    });

    const longLivedToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in;
    console.log('✅ Long-lived token received:', longLivedToken.substring(0, 20) + '...');
    console.log('⏰ Token expires in:', expiresIn, 'seconds');

    log('instagram-oauth', 'Шаг 3: Получаем информацию о пользователе...');
    // Шаг 3: Получаем информацию о пользователе
    const userResponse = await axios.get('https://graph.facebook.com/v23.0/me', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,email'
      },
      ...axiosConfig
    });

    log('instagram-oauth', 'Шаг 4: Получаем страницы пользователя...');
    // Шаг 4: Получаем страницы с Instagram аккаунтами
    const pagesResponse = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}',
        limit: 100
      },
      ...axiosConfig
    });

    // Фильтруем только страницы с подключенным Instagram
    const pagesWithInstagram = pagesResponse.data.data?.filter((page: any) =>
      page.instagram_business_account
    ) || [];

    log('instagram-oauth', `Найдено страниц с Instagram: ${pagesWithInstagram.length}`);

    // Подготавливаем данные для отправки в N8N webhook
    const webhookData = {
      success: true,
      appId: session.appId,
      longLivedToken,
      expiresIn,
      user: userResponse.data,
      pages: pagesWithInstagram,
      instagramAccounts: pagesWithInstagram.map((page: any) => ({
        instagramId: page.instagram_business_account.id,
        username: page.instagram_business_account.username,
        name: page.instagram_business_account.name,
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token
      })),
      timestamp: new Date().toISOString()
    };

    // Сохраняем данные Instagram напрямую в social_media_settings кампании
    try {
      // Подготавливаем данные для сохранения в кампанию
      const instagramSettings = {
        appId: session.appId,
        appSecret: session.appSecret, // Сохраняем App Secret в БД
        longLivedToken,
        expiresIn,
        tokenExpiresAt: (expiresIn && expiresIn !== 'never' && !isNaN(parseInt(expiresIn))) 
          ? new Date(Date.now() + (parseInt(expiresIn) * 1000)).toISOString() 
          : null,
        user: userResponse.data,
        instagramAccounts: webhookData.instagramAccounts,
        authTimestamp: new Date().toISOString(),
        status: 'active'
      };

      // Получаем текущие настройки кампании
      const DIRECTUS_URL = process.env.DIRECTUS_URL;
      const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

      const currentCampaignResponse = await axios.get(
        `${DIRECTUS_URL}/items/user_campaigns/${session.campaignId}`,
        {
          headers: {
            'Authorization': `Bearer ${DIRECTUS_TOKEN}`
          }
        }
      );

      // Обновляем social_media_settings с данными Instagram
      const currentSettings = currentCampaignResponse.data.data.social_media_settings || {};
      const existingInstagram = currentSettings.instagram || {};
      
      console.log('💾 Preparing to save Instagram OAuth data to campaign:', session.campaignId);
      console.log('📋 Instagram settings to save:', {
        appId: instagramSettings.appId,
        hasAppSecret: !!instagramSettings.appSecret,
        hasLongLivedToken: !!instagramSettings.longLivedToken,
        userInfo: instagramSettings.user,
        instagramAccountsCount: instagramSettings.instagramAccounts?.length || 0
      });
      
      // Объединяем существующие настройки с новыми OAuth данными
      const updatedInstagramSettings = {
        ...existingInstagram,
        ...instagramSettings,
        // КРИТИЧЕСКИ ВАЖНО: всегда используем НОВЫЙ токен из OAuth
        token: longLivedToken, // Используем прямой токен
        accessToken: longLivedToken, // Дублируем для совместимости
        businessAccountId: existingInstagram.businessAccountId || 
          (instagramSettings.instagramAccounts && instagramSettings.instagramAccounts[0] ? 
            instagramSettings.instagramAccounts[0].instagramId : null)
      };
      
      const updatedSettings = {
        ...currentSettings,
        instagram: updatedInstagramSettings
      };

      // Сохраняем обновленные настройки в кампанию
      console.log('💾 Saving to Directus campaign:', session.campaignId);
      console.log('📋 Settings being saved:', JSON.stringify(updatedSettings, null, 2));
      
      const saveResponse = await axios.patch(
        `${DIRECTUS_URL}/items/user_campaigns/${session.campaignId}`,
        {
          social_media_settings: updatedSettings
        },
        {
          headers: {
            'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ Instagram settings saved to database successfully!');
      console.log('📋 Save response status:', saveResponse.status);
      console.log('💾 Final settings saved:', JSON.stringify(updatedInstagramSettings, null, 2));
      
      log('instagram-oauth', `Instagram настройки успешно сохранены в кампанию ${session.campaignId}`);
      log('instagram-oauth', `Сохраненные настройки: ${JSON.stringify(updatedInstagramSettings, null, 2)}`);

      // Дополнительно отправляем в N8N webhook если указан
      if (session.webhookUrl) {
        try {
          await axios.post(session.webhookUrl, webhookData, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          log('instagram-oauth', `Данные также отправлены в N8N webhook: ${session.webhookUrl}`);
        } catch (webhookError) {
          log('instagram-oauth', `Ошибка отправки в N8N webhook: ${webhookError}`);
        }
      }

    } catch (saveError) {
      log('instagram-oauth', `Ошибка сохранения Instagram настроек: ${saveError}`);
    }

    // Очищаем сессию
    oauthSessions.delete(state);

    // Возвращаем успешный ответ с данными
    const responseData = {
      success: true,
      message: 'Instagram авторизация завершена успешно',
      appId: session.appId, // Важно! App ID должен быть на верхнем уровне
      longLivedToken, // Токен на верхнем уровне для callback
      instagramAccounts: webhookData.instagramAccounts,
      user: userResponse.data,
      expiresIn
    };
    
    console.log('📡 CALLBACK RESPONSE - Sending to client:', {
      success: responseData.success,
      message: responseData.message,
      hasToken: !!responseData.longLivedToken,
      tokenPreview: responseData.longLivedToken?.substring(0, 20) + '...',
      userInfo: responseData.user,
      accountsCount: responseData.instagramAccounts?.length || 0
    });
    
    res.json(responseData);

  } catch (error) {
    log('instagram-oauth', `Ошибка OAuth callback: ${error}`);
    
    // Очищаем сессию при ошибке
    oauthSessions.delete(state);
    
    res.status(500).json({
      error: 'Ошибка при обработке OAuth callback',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Эндпоинт для проверки статуса OAuth сессии
router.get('/instagram/auth/status/:state', (req, res) => {
  const { state } = req.params;
  const session = oauthSessions.get(state);
  
  if (!session) {
    return res.json({ exists: false });
  }
  
  res.json({
    exists: true,
    timestamp: session.timestamp,
    appId: session.appId
  });
});

export default router;