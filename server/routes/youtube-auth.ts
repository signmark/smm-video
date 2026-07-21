/**
 * YouTube OAuth2 Authentication Routes
 */

import { Router } from 'express';
import { YouTubeOAuth } from '../utils/youtube-oauth';
import { authenticateUser } from '../middleware/user-auth';
import { GlobalApiKeysService } from '../services/global-api-keys';
import { authorizeCampaignAccess } from '../services/campaign-access';
import { randomBytes } from 'node:crypto';

const router = Router();

// Экземпляр сервиса для работы с глобальными API ключами
const globalApiKeysService = new GlobalApiKeysService();

// Временное хранилище для OAuth состояний (в продакшене использовать Redis)
const oauthStates = new Map<string, { userId: string; campaignId?: string; timestamp: number }>();

/**
 * Инициирует OAuth авторизацию YouTube
 */
router.post('/youtube/auth/start', authenticateUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    // Получаем campaignId из тела запроса
    const { campaignId } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });
    await authorizeCampaignAccess(campaignId, userId, req.user?.token || '', req.user?.is_smm_admin === true);
    console.log('[youtube-auth] Starting OAuth for campaignId:', campaignId);

    // Получаем конфигурацию YouTube из базы данных
    const youtubeConfig = await globalApiKeysService.getYouTubeConfig();

    console.log('[youtube-auth] YouTube config loaded from database:', youtubeConfig ? 'успешно' : 'ошибка');

    if (!youtubeConfig) {
      return res.status(500).json({
        error: 'YouTube OAuth не настроен',
        details: 'Отсутствуют YOUTUBE_CLIENT_ID или YOUTUBE_CLIENT_SECRET в базе данных'
      });
    }

    const { clientId, clientSecret, redirectUri } = youtubeConfig;

    const youtubeOAuth = new YouTubeOAuth(youtubeConfig);

    // Создаем state объект с campaignId
    const stateData = {
      userId,
      campaignId,
      timestamp: Date.now()
    };

    // Генерируем уникальный state для защиты от CSRF
    const stateKey = randomBytes(32).toString('base64url');
    oauthStates.set(stateKey, stateData);

    // Кодируем state с данными в Base64 для передачи в URL
    const encodedState = Buffer.from(JSON.stringify({
      key: stateKey,
      campaignId
    })).toString('base64');

    const authUrl = youtubeOAuth.getAuthUrl();
    const authUrlWithState = `${authUrl}&state=${encodedState}`;

    res.json({
      success: true,
      authUrl: authUrlWithState,
      message: 'Перейдите по ссылке для авторизации YouTube'
    });
  } catch (error) {
    console.error('Ошибка инициации YouTube OAuth:', error instanceof Error ? error.message : String(error));
    res.status(500).json({
      error: 'Ошибка инициации авторизации',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Обрабатывает callback от YouTube OAuth
 */
router.get('/youtube/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({
        error: 'Авторизация отклонена',
        details: error
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        error: 'Отсутствуют необходимые параметры'
      });
    }

    // Декодируем state параметр
    let stateKey;
    let campaignId: string | undefined;
    let userId;

    try {
      // Пробуем декодировать новый формат state
      const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
      stateKey = decodedState.key;
      console.log('[youtube-auth] Decoded state key received');
    } catch (e) {
      // Fallback для старых форматов state
      stateKey = state as string;
      console.log('[youtube-auth] Using legacy state format');
    }

    const stateData = oauthStates.get(stateKey);

    if (!stateData) {
      return res.status(400).json({
        error: 'Неверный state параметр'
      });
    } else {
      userId = stateData.userId;
      // The client-visible base64 state is not authoritative. The campaign is
      // bound to the opaque server-side state created by the authenticated start.
      campaignId = stateData.campaignId;
    }

    // Проверяем время жизни state (10 минут) только для обычных state
    if (stateData) {
      if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
        oauthStates.delete(stateKey);
        return res.status(400).json({
          error: 'State параметр истек'
        });
      }
      oauthStates.delete(stateKey);
    }

    // Получаем конфигурацию YouTube из базы данных
    const youtubeConfig = await globalApiKeysService.getYouTubeConfig();

    if (!youtubeConfig) {
      return res.status(500).json({
        error: 'YouTube OAuth не настроен',
        details: 'Отсутствует конфигурация YouTube в базе данных'
      });
    }

    const youtubeOAuth = new YouTubeOAuth(youtubeConfig);

    // Обмениваем code на токены
    const tokens = await youtubeOAuth.exchangeCodeForTokens(code as string);
    console.log(`[youtube-auth] OAuth токены успешно получены для пользователя ${userId}`);

    // Получаем информацию о канале
    const channelInfo = await youtubeOAuth.getChannelInfo(tokens.accessToken);
    console.log(`[youtube-auth] Канал: ${channelInfo.channelTitle} (${channelInfo.channelId})`);

    // Сохраняем токены напрямую в Directus (не через frontend)
    if (campaignId) {
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      const directusUrl = process.env.DIRECTUS_URL;
      if (!adminToken || !directusUrl) throw new Error('Directus OAuth storage is not configured');
      try {
          await authorizeCampaignAccess(campaignId, userId, adminToken, false);
          const axios = (await import('axios')).default;
          const getCamp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          const existing = getCamp.data?.data?.social_media_settings || {};
          const updatedSettings = {
            ...existing,
            youtube: {
              ...(existing.youtube || {}),
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              channelId: channelInfo.channelId,
              channelTitle: channelInfo.channelTitle,
              setupCompletedAt: new Date().toISOString(),
              configured: true
            }
          };
          await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
            social_media_settings: updatedSettings
          }, {
            headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
          });
          console.log(`[youtube-auth] ✅ Токены сохранены в Directus для кампании ${campaignId}`);
      } catch (saveErr: any) {
        console.error(`[youtube-auth] ❌ Ошибка сохранения в Directus: ${saveErr.message}`);
        throw new Error('Не удалось безопасно сохранить YouTube OAuth-сессию');
      }
    } else throw new Error('OAuth state is not bound to a campaign');

    const params = new URLSearchParams({
      success: 'true',
      message: `YouTube подключен: ${channelInfo.channelTitle}`,
      saved: 'true'
    });

    if (campaignId) {
      params.set('campaignId', campaignId);
    }

    res.redirect('/youtube-callback?' + params.toString());
  } catch (error) {
    console.error('Ошибка обработки YouTube callback:', error instanceof Error ? error.message : String(error));
    // Перенаправляем на callback страницу с ошибкой
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    res.redirect('/youtube-callback?error=true&message=' + encodeURIComponent(errorMessage));
  }
});

/**
 * Тестирует YouTube соединение
 */
router.post('/youtube/test', authenticateUser, async (req, res) => {
  try {
    const { accessToken, refreshToken, channelId } = req.body;

    if (!accessToken || !channelId) {
      return res.status(400).json({
        error: 'Отсутствуют необходимые параметры'
      });
    }

    // Получаем конфигурацию YouTube из базы данных
    const youtubeConfig = await globalApiKeysService.getYouTubeConfig();

    if (!youtubeConfig) {
      return res.status(500).json({
        error: 'YouTube OAuth не настроен',
        details: 'Отсутствует конфигурация YouTube в базе данных'
      });
    }

    const youtubeOAuth = new YouTubeOAuth(youtubeConfig);
    const channelInfo = await youtubeOAuth.getChannelInfo(accessToken);

    res.json({
      success: true,
      message: 'YouTube соединение работает',
      channelInfo: {
        channelId: channelInfo.channelId,
        title: channelInfo.channelTitle
      }
    });
  } catch (error) {
    console.error('Ошибка тестирования YouTube:', error instanceof Error ? error.message : String(error));
    res.status(500).json({
      error: 'Ошибка тестирования соединения',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

/**
 * Тестовый endpoint для обновления redirect URI в базе данных
 */
router.post('/youtube/fix-redirect-uri', authenticateUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Пользователь не авторизован' });
    }

    console.log('🔧 [youtube-auth] Исправляем redirect URI в базе данных...');

    // Определяем правильный redirect URI для текущей среды
    const smmDomain = process.env.SMM_DOMAIN;
    const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
    const directusUrl = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_URL;
    let correctRedirectUri;

    if (smmDomain) {
      // Приоритет 0: SMM_DOMAIN явно задан
      correctRedirectUri = `https://${smmDomain}/api/youtube/auth/callback`;
    } else if (replitDevDomain) {
      // Приоритет 1: Replit среда
      correctRedirectUri = `https://${replitDevDomain}/api/youtube/auth/callback`;
    } else if (directusUrl?.includes('omemo.tech')) {
      correctRedirectUri = 'https://smm.omemo.tech/api/youtube/auth/callback';
    } else if (directusUrl?.includes('nplanner.ru')) {
      correctRedirectUri = 'https://smm.omemo.tech/api/youtube/auth/callback';
    } else {
      correctRedirectUri = 'http://localhost:5000/api/youtube/auth/callback';
    }

    console.log('🔧 [youtube-auth] Правильный redirect URI:', correctRedirectUri);

    // Обновляем redirect URI в базе данных через GlobalApiKeysService
    const success = await globalApiKeysService.updateYouTubeRedirectUri(correctRedirectUri);

    if (success) {
      console.log('✅ [youtube-auth] Redirect URI успешно обновлен в базе данных');
      res.json({
        success: true,
        message: 'Redirect URI исправлен',
        redirectUri: correctRedirectUri
      });
    } else {
      console.log('❌ [youtube-auth] Не удалось обновить redirect URI');
      res.status(500).json({
        error: 'Не удалось обновить redirect URI в базе данных'
      });
    }

  } catch (error) {
    console.error('❌ [youtube-auth] Ошибка при исправлении redirect URI:', error instanceof Error ? error.message : String(error));
    res.status(500).json({
      error: 'Ошибка при исправлении redirect URI',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

export default router;
