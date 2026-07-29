import express from 'express';
import axios from 'axios';
import { authenticateUser } from '../middleware/user-auth';
import { authorizeCampaignAccess, CampaignAccessError } from '../services/campaign-access';
import { sanitizeOAuthSecrets } from '../services/oauth-response-sanitizer';
import { pickPlatformToken } from '../services/campaign-token-resolver';

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
 * Получение Facebook настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/facebook-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    // Используем системный токен как fallback для доступа к базе данных
    const tokenToUse = userToken || process.env.DIRECTUS_STATIC_TOKEN;
    
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
    const facebookSettings = socialMediaSettings.facebook || null;

    res.json({
      success: true,
      settings: sanitizeOAuthSecrets(facebookSettings)
    });

  } catch (error: any) {
    console.error('❌ Error retrieving Facebook settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения настроек Facebook',
      details: error.message
    });
  }
});

/**
 * Сохранение Facebook настроек в JSON кампании
 */
router.post('/campaigns/:campaignId/facebook-settings', async (req, res) => {
  const { campaignId } = req.params;
  // Принимаем и camelCase, и snake_case (ручной выбор в визарде шлёт page_id/page_name)
  const token = req.body.token;
  const pageId = req.body.pageId || req.body.page_id;
  const pageName = req.body.pageName || req.body.page_name;
  const userAccessToken = req.body.userToken || req.body.user_token;
  const authToken = req.headers.authorization?.replace('Bearer ', '');

  if (!authToken) {
    return res.status(401).json({
      success: false,
      error: 'Токен авторизации обязателен'
    });
  }

  if (!pageId) {
    return res.status(400).json({
      success: false,
      error: 'Page ID обязателен'
    });
  }

  // Проверяем что токен не содержит лог консоли
  if (token && (token.includes('Facebook Wizard:') || token.includes('%20') || token.includes('FacebookSetupWizard'))) {
    return res.status(400).json({
      success: false,
      error: 'Получен некорректный токен Facebook'
    });
  }

  try {
    // Получаем текущие настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const existingSocialSettings = campaign.social_media_settings || {};
    const existingFacebook = existingSocialSettings.facebook || {};

    // Токен в body опционален (клиент его больше не видит) — fallback:
    // уже сохранённый facebook.token, затем каскад «Взять из ИГ» (общий резолвер)
    const tokenToSave = token
      || existingFacebook.token
      || pickPlatformToken(existingSocialSettings, 'instagram');
    if (!tokenToSave) {
      return res.status(400).json({
        success: false,
        error: 'Facebook токен не найден: подключите Instagram или введите токен вручную'
      });
    }

    // Объединяем существующие и новые настройки с раздельным хранением токенов
    const updatedSettings = {
      ...existingSocialSettings,
      facebook: {
        ...existingFacebook, // Сохраняем существующие данные
        
        // Основной токен страницы для публикации
        token: userAccessToken && token === userAccessToken && existingFacebook.token
          ? existingFacebook.token
          : tokenToSave,
        pageId,
        pageName: pageName || existingFacebook.pageName || '',

        // Пользовательский токен для получения списка страниц
        userToken: userAccessToken || existingFacebook.userToken || tokenToSave,
        
        // Метаданные
        setupCompletedAt: new Date().toISOString(),
        configured: true,
        
        // Дополнительная информация
        tokenType: userAccessToken ? 'page' : 'user' // Определяем тип основного токена
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
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Facebook settings saved successfully', {
      campaignId,
      pageName: pageName,
      hasToken: !!token
    });

    res.json({
      success: true,
      message: 'Facebook настройки сохранены успешно'
    });

  } catch (error: any) {
    console.error('❌ Error saving Facebook settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка сохранения настроек Facebook',
      details: error.message
    });
  }
});

export default router;
