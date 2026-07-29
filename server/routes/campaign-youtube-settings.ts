import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { authenticateUser } from '../middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from '../services/campaign-access';

const router = express.Router();
// Авторизация вешается на каждый маршрут, а НЕ через router.use.
//
// Этот роутер смонтирован как app.use('/api', ...), поэтому верхнеуровневый
// router.use(authenticateUser) применялся ко всему /api и служил ещё одним
// незапланированным гейтом — он же отбивал публичные пути (медиа-прокси для
// соцсетей, подписанные ссылки из письма). Явный гейт живёт в
// server/middleware/api-auth-gate.ts.

function sanitizeYoutubeSettings(settings: any) {
  if (!settings) return null;
  return {
    channelId: settings.channelId || '',
    channelTitle: settings.channelTitle || '',
    configured: Boolean(settings.configured && settings.channelId),
    setupCompletedAt: settings.setupCompletedAt || null,
    hasAccessToken: Boolean(settings.accessToken),
    hasRefreshToken: Boolean(settings.refreshToken),
  };
}

/**
 * Получение YouTube настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/youtube-settings', authenticateUser, async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.user?.token || '';

  try {
    await authorizeCampaignAccess(campaignId, req.user?.id, userToken, req.user?.is_smm_admin === true);

    console.log('📋 [YOUTUBE-SETTINGS] Loading YouTube settings for campaign:', campaignId);

    // Получаем настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const socialMediaSettings = campaign.social_media_settings || {};
    const youtubeSettings = socialMediaSettings.youtube || null;

    console.log('📋 [YOUTUBE-SETTINGS] YouTube settings found:', youtubeSettings ? {
      channelId: youtubeSettings.channelId,
      configured: !!youtubeSettings.configured,
      hasAccessToken: !!youtubeSettings.accessToken,
      hasRefreshToken: !!youtubeSettings.refreshToken
    } : null);

    res.json({
      success: true,
      settings: sanitizeYoutubeSettings(youtubeSettings)
    });

  } catch (error: any) {
    console.error('❌ Error retrieving YouTube settings:', error.message);
    if (error instanceof CampaignAccessError) {
      return res.status(error.status).json({ success: false, code: error.code, error: 'Кампания не найдена' });
    }
    res.status(500).json({
      success: false,
      error: 'Ошибка при получении YouTube настроек',
      details: error.message
    });
  }
});

/**
 * Сохранение YouTube настроек в JSON кампании
 */
router.patch('/campaigns/:campaignId/youtube-settings', authenticateUser, async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken, refreshToken, channelId, channelTitle, setupCompletedAt } = req.body;
  const userToken = req.user?.token || '';

  try {
    if (accessToken || refreshToken) {
      return res.status(400).json({
        success: false,
        code: 'OAUTH_TOKENS_SERVER_MANAGED',
        error: 'OAuth-токены сохраняются только серверным callback'
      });
    }

    if (!channelId) return res.status(400).json({ success: false, error: 'Channel ID обязателен' });
    await authorizeCampaignAccess(campaignId, req.user?.id, userToken, req.user?.is_smm_admin === true);

    // Получим существующие настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const existingSettings = campaign.social_media_settings || {};

    // Обновляем YouTube настройки (сохраняем и объединяем с существующими)
    const existingYoutube = existingSettings.youtube || {};
    const updatedSettings = {
      ...existingSettings,
      youtube: {
        ...existingYoutube, // Сохраняем существующие данные
        channelId,
        channelTitle: channelTitle || existingYoutube.channelTitle || '',
        setupCompletedAt: setupCompletedAt || new Date().toISOString(),
        configured: true
      }
    };

    // Сохраняем обновленные настройки
    const updateResponse = await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        social_media_settings: updatedSettings
      },
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    log('YouTube settings saved successfully', {
      campaignId,
      channelTitle: channelTitle,
      hasAccessToken: Boolean(existingYoutube.accessToken)
    });

    res.json({
      success: true,
      message: 'YouTube настройки успешно сохранены',
      settings: sanitizeYoutubeSettings(updatedSettings.youtube)
    });

  } catch (error: any) {
    console.error('❌ Error saving YouTube settings:', error.message);
    if (error instanceof CampaignAccessError) {
      return res.status(error.status).json({ success: false, code: error.code, error: 'Кампания не найдена' });
    }
    res.status(500).json({
      success: false,
      error: 'Ошибка при сохранении YouTube настроек',
      details: error.message
    });
  }
});

export default router;
