import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { authenticateUser } from '../middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from '../services/campaign-access';
import { sanitizeOAuthSecrets } from '../services/oauth-response-sanitizer';

const router = express.Router();
router.use(authenticateUser);
router.param('campaignId', async (req, res, next, campaignId) => {
  try {
    await authorizeCampaignAccess(campaignId, req.user?.id, req.user?.token || '', req.user?.is_smm_admin === true);
    next();
  } catch (error) {
    if (error instanceof CampaignAccessError) return res.status(error.status).json({ error: error.code });
    next(error);
  }
});

/**
 * Получение VK настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/vk-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;

    if (!tokenToUse) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не доступен'
      });
    }

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
      settings: sanitizeOAuthSecrets(vkSettings)
    });

  } catch (error: any) {
    console.error('❌ Error retrieving VK settings:', error.message);
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return res.status(403).json({ success: false, error: 'Нет прав на чтение этой кампании' });
    }
    res.status(500).json({
      success: false,
      error: 'Ошибка при получении VK настроек',
      details: error.message
    });
  }
});

/**
 * Сохранение VK настроек в JSON кампании.
 * Авторизация: сначала проверяем, что пользователь владеет кампанией (GET с userToken через Directus).
 * Запись производится через admin-токен (пользователь может не иметь прав на прямую запись).
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

    if (!userToken) {
      return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }

    // Шаг 1: Проверка прав доступа через пользовательский токен.
    // Directus вернёт 403, если пользователь не владеет кампанией.
    let existingSettings: Record<string, any>;
    try {
      const ownershipCheck = await axios.get(
        `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
        {
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      existingSettings = ownershipCheck.data.data.social_media_settings || {};
    } catch (authErr: any) {
      const status = authErr.response?.status;
      if (status === 401 || status === 403) {
        return res.status(403).json({ success: false, error: 'Нет прав на изменение этой кампании' });
      }
      throw authErr;
    }

    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    if (!adminToken) {
      return res.status(500).json({ success: false, error: 'Не настроен admin-токен Directus (DIRECTUS_STATIC_TOKEN / DIRECTUS_ADMIN_TOKEN)' });
    }

    // Шаг 2: Запись через admin-токен (надёжно, без риска 403 на запись)
    const existingVk = existingSettings.vk || {};
    const vkUpdate: Record<string, any> = {
      ...existingVk,
      token,
      groupId,
      groupName: groupName || existingVk.groupName || '',
      setupCompletedAt: setupCompletedAt || new Date().toISOString(),
      configured: true,
      authExpired: false
    };
    if (refreshToken) vkUpdate.refreshToken = refreshToken;
    if (deviceId) vkUpdate.deviceId = deviceId;
    if (clientId) vkUpdate.clientId = clientId;
    if (tokenExpiresAt) vkUpdate.tokenExpiresAt = tokenExpiresAt;

    const updatedSettings = {
      ...existingSettings,
      vk: vkUpdate
    };

    await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      { social_media_settings: updatedSettings },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    log('VK settings saved successfully', { campaignId, groupName, hasToken: !!token });

    res.json({
      success: true,
      message: 'VK настройки успешно сохранены',
      settings: sanitizeOAuthSecrets(updatedSettings.vk)
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
