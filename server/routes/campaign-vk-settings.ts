import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

/**
 * Получение VK настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/vk-settings', async (req, res) => {
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
    const vkSettings = socialMediaSettings.vk || null;

    res.json({
      success: true,
      settings: vkSettings
    });

  } catch (error: any) {
    console.error('❌ Error retrieving VK settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при получении VK настроек',
      details: error.message
    });
  }
});

/**
 * Сохранение VK настроек в JSON кампании
 */
router.patch('/campaigns/:campaignId/vk-settings', async (req, res) => {
  const { campaignId } = req.params;
  const {
    token,
    groupId,
    groupName,
    setupCompletedAt,
    refreshToken,
    deviceId,
    clientId,
    tokenExpiresAt
  } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!token || !groupId) {
      return res.status(400).json({
        success: false,
        error: 'Token и Group ID обязательны'
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

    // Обновляем VK настройки (сохраняем и объединяем с существующими)
    const existingVk = existingSettings.vk || {};
    const vkUpdate: Record<string, any> = {
      ...existingVk,
      token,
      groupId,
      groupName: groupName || existingVk.groupName || '',
      setupCompletedAt: setupCompletedAt || new Date().toISOString(),
      configured: true
    };
    if (refreshToken) vkUpdate.refreshToken = refreshToken;
    if (deviceId) vkUpdate.deviceId = deviceId;
    if (clientId) vkUpdate.clientId = clientId;
    if (tokenExpiresAt) vkUpdate.tokenExpiresAt = tokenExpiresAt;

    const updatedSettings = {
      ...existingSettings,
      vk: vkUpdate
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

    log('VK settings saved successfully', {
      campaignId,
      groupName: groupName,
      hasToken: !!token
    });

    res.json({
      success: true,
      message: 'VK настройки успешно сохранены',
      settings: updatedSettings.vk
    });

  } catch (error: any) {
    console.error('❌ Error saving VK settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при сохранении VK настроек',
      details: error.message
    });
  }
});

export default router;