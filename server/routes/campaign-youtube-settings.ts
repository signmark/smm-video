import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

/**
 * Получение YouTube настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/youtube-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    // Используем системный токен как fallback для доступа к базе данных
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;
    
    if (!tokenToUse) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не доступен'
      });
    }

    console.log('📋 [YOUTUBE-SETTINGS] Loading YouTube settings for campaign:', campaignId);

    // Получаем настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenToUse}`,
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
      settings: youtubeSettings
    });

  } catch (error: any) {
    console.error('❌ Error retrieving YouTube settings:', error.message);
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
router.patch('/campaigns/:campaignId/youtube-settings', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken, refreshToken, channelId, channelTitle, setupCompletedAt } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!accessToken || !channelId) {
      return res.status(400).json({
        success: false,
        error: 'Access Token и Channel ID обязательны'
      });
    }

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
        accessToken,
        refreshToken: refreshToken || existingYoutube.refreshToken,
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
      hasAccessToken: !!accessToken
    });

    res.json({
      success: true,
      message: 'YouTube настройки успешно сохранены',
      settings: updatedSettings.youtube
    });

  } catch (error: any) {
    console.error('❌ Error saving YouTube settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при сохранении YouTube настроек',
      details: error.message
    });
  }
});

export default router;